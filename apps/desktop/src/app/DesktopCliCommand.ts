// @effect-diagnostics-next-line nodeBuiltinImport:off -- FileSystem.access has no execute check.
import * as NodeFSP from "node:fs/promises";

import type { DesktopCliCommandState } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { pathSetup, readUserLoginShell } from "@t3tools/shared/shell";

import * as DesktopCliShim from "./DesktopCliShim.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

const { logInfo, logWarning } = makeComponentLogger("desktop-cli-command");

export class DesktopCliCommandError extends Schema.TaggedError<DesktopCliCommandError>()(
  "DesktopCliCommandError",
  { message: Schema.String },
) {}

const userCandidates = (home: string) => [`${home}/.local/bin`, `${home}/bin`];

// Older builds also linked into these macOS folders. Such a link is found, updated in place, and
// removed, but no new link goes there.
const knownLocations = (home: string, platform: NodeJS.Platform) =>
  platform === "darwin"
    ? [...userCandidates(home), "/opt/homebrew/bin", "/usr/local/bin"]
    : userCandidates(home);

const pathEntries = (value: string | undefined, separator: string) =>
  (value ?? "").split(separator).filter((entry) => entry.length > 0);

const sameWindowsPath = (left: string, right: string) =>
  left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase();

// Preserve REG_EXPAND_SZ and %VAR% expansion; notify Explorer with WM_SETTINGCHANGE.
// Failed reads must exit nonzero to prevent replacing PATH wholesale.
const WINDOWS_USER_PATH_SCRIPT = `
$ErrorActionPreference = 'Stop'
if ($env:T3_SET -eq '1') {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
  if ($key.GetValueNames() -contains 'Path' -and $key.GetValueKind('Path') -eq 'String') {
    $kind = [Microsoft.Win32.RegistryValueKind]::String
  }
  $key.SetValue('Path', $env:T3_PATH, $kind)
  Add-Type -Namespace T3 -Name Env -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);'
  $result = [System.UIntPtr]::Zero
  [void][T3.Env]::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
} else {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  $value = if ($key) { $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames') } else { '' }
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)))
}
`;

export class DesktopCliCommand extends Context.Service<
  DesktopCliCommand,
  {
    readonly state: Effect.Effect<DesktopCliCommandState>;
    readonly install: Effect.Effect<DesktopCliCommandState, DesktopCliCommandError>;
    readonly uninstall: Effect.Effect<DesktopCliCommandState, DesktopCliCommandError>;
    /** Adds the installed command's folder to PATH in the user's shell startup file. */
    readonly addToPath: Effect.Effect<DesktopCliCommandState, DesktopCliCommandError>;
    /** Installs the command on a fresh install's first launch; removing it in Settings sticks. */
    readonly installOnFirstLaunch: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopCliCommand") {}

/** PATH links to the app's launchers on macOS and Linux. */
const makeLinks = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  // Read the live env: shell discovery patches PATH after startup.
  const env = yield* HostProcess.Environment;
  const path = environment.path;
  const locations = knownLocations(environment.homeDirectory, environment.platform);
  const launcherFor = (name: DesktopCliShim.CliCommandName) =>
    DesktopCliShim.launcherPath(environment, name);

  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));
  const present = (target: string) =>
    fs.readLink(target).pipe(
      Effect.as(true),
      Effect.catch(() => exists(target)),
    );
  const writableDirectory = (directory: string) =>
    fs.access(directory, { writable: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  // The launcher is a few KB; never read a large binary such as Ghostscript's `gs`.
  const launcherText = Effect.fn("DesktopCliCommand.launcherText")(
    function* (target: string) {
      const info = yield* fs.stat(target);
      if (info.type !== "File" || Number(info.size) > 16_384) return "";
      return yield* fs.readFileString(target);
    },
    Effect.orElseSucceed(() => ""),
  );

  const isOurLink = Effect.fn("DesktopCliCommand.isOurLink")(
    function* (link: string) {
      yield* fs.readLink(link);
      return DesktopCliShim.isOurLauncher(yield* launcherText(link));
    },
    Effect.orElseSucceed(() => false),
  );

  const isReplaceable = (target: string) =>
    launcherText(target).pipe(Effect.map(DesktopCliShim.isReplaceableLauncher));

  // PATH can reach the regular launcher directly; removal still requires isOurLink.
  const runsOurLauncher = Effect.fn("DesktopCliCommand.runsOurLauncher")(
    // Another home's link is marked too, so compare where it leads, not the marker alone.
    function* (candidate: string, name: DesktopCliShim.CliCommandName) {
      const [resolved, ours] = yield* Effect.all([
        fs.realPath(candidate),
        fs.realPath(launcherFor(name)),
      ]);
      if (resolved !== ours) return false;
      return DesktopCliShim.isOurLauncher(yield* launcherText(candidate));
    },
    Effect.orElseSucceed(() => false),
  );

  const isExecutableFile = Effect.fn("DesktopCliCommand.isExecutableFile")(
    function* (target: string) {
      if ((yield* fs.stat(target)).type !== "File") return false;
      yield* Effect.tryPromise({
        try: () => NodeFSP.access(target, NodeFSP.constants.X_OK),
        catch: () => new DesktopCliCommandError({ message: `${target} is not executable.` }),
      });
      return true;
    },
    Effect.orElseSucceed(() => false),
  );

  const firstOnPath = Effect.fn("DesktopCliCommand.firstOnPath")(function* (
    name: DesktopCliShim.CliCommandName,
  ) {
    for (const directory of pathEntries(env.PATH, ":")) {
      const candidate = path.join(directory, name);
      if (yield* isExecutableFile(candidate)) return Option.some(candidate);
    }
    return Option.none<string>();
  });

  const foreignFirstOnPath = Effect.fn("DesktopCliCommand.foreignFirstOnPath")(function* (
    name: DesktopCliShim.CliCommandName,
  ) {
    if (environment.platform === "win32") return Option.none<string>();
    const first = yield* firstOnPath(name);
    if (Option.isNone(first)) return first;
    if ((yield* runsOurLauncher(first.value, name)) || (yield* isReplaceable(first.value))) {
      return Option.none<string>();
    }
    return first;
  });

  /** Ghostscript installs `gs`; ours would shadow it or be shadowed, so the command falls back to `t3`. */
  const gsTakenBy = Effect.gen(function* () {
    if (environment.platform === "win32") return Option.none<string>();
    for (const directory of locations) {
      const candidate = path.join(directory, "gs");
      if ((yield* present(candidate)) && !(yield* isReplaceable(candidate))) {
        return Option.some(candidate);
      }
    }
    for (const directory of pathEntries(env.PATH, ":")) {
      const candidate = path.join(directory, "gs");
      if (
        (yield* isExecutableFile(candidate)) &&
        !(yield* runsOurLauncher(candidate, "gs")) &&
        !(yield* isReplaceable(candidate))
      ) {
        return Option.some(candidate);
      }
    }
    return Option.none<string>();
  });

  const ourLinkIn = Effect.fn("DesktopCliCommand.ourLinkIn")(function* (
    name: DesktopCliShim.CliCommandName,
  ) {
    for (const directory of locations) {
      const link = path.join(directory, name);
      if (yield* isOurLink(link)) return Option.some(link);
    }
    return Option.none<string>();
  });

  /** A link to this home's launcher; another home's link is marked too. */
  const leadsHere = (link: string, name: DesktopCliShim.CliCommandName) =>
    fs.readLink(link).pipe(
      Effect.map((target) => target === launcherFor(name)),
      Effect.orElseSucceed(() => false),
    );

  return {
    env,
    launcherFor,
    exists,
    present,
    writableDirectory,
    isOurLink,
    isReplaceable,
    runsOurLauncher,
    firstOnPath,
    foreignFirstOnPath,
    gsTakenBy,
    ourLinkIn,
    leadsHere,
  };
});

/** Adds `gs` beside a `t3` link from before the rename when no other `gs` is there or on PATH. */
export const handover = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (!environment.isPackaged || environment.platform === "win32") return Option.none<string>();
  const fs = yield* FileSystem.FileSystem;
  const links = yield* makeLinks;
  if (Option.isSome(yield* links.ourLinkIn("gs"))) return Option.none<string>();
  const t3 = yield* links.ourLinkIn("t3");
  if (Option.isNone(t3) || Option.isSome(yield* links.gsTakenBy)) return Option.none<string>();
  const directory = environment.path.dirname(t3.value);
  if (!(yield* links.writableDirectory(directory))) return Option.none<string>();
  const link = environment.path.join(directory, "gs");
  if (yield* links.present(link)) {
    if (!(yield* links.isReplaceable(link))) return Option.none<string>();
    yield* fs.remove(link);
  }
  yield* fs.symlink(links.launcherFor("gs"), link);
  return Option.some(link);
}).pipe(Effect.withSpan("desktop.cliCommand.handover"));

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const links = yield* makeLinks;
  // Windows variable names are case-insensitive only on process.env, not on Config's copy of it.
  const env = links.env;
  const path = environment.path;
  const windows = environment.platform === "win32";
  const launcher = DesktopCliShim.launcherPath(environment);
  const binDirectory = path.dirname(launcher);
  const ownedPathMarker = path.join(environment.stateDir, "cli-command-path-entry");
  const firstLaunchMarker = path.join(environment.stateDir, "cli-command-first-launch");

  const fail = (message: string) => new DesktopCliCommandError({ message });
  const exists = links.exists;
  // Read before this launch writes either one: an app that ran before left its launcher or
  // settings. Its user may have removed gs or chosen another, so only Settings installs there.
  const freshInstall =
    !(yield* exists(launcher)) && !(yield* exists(environment.desktopSettingsPath));

  const powershell = (overrides: Record<string, string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = env.SystemRoot ?? env.WINDIR;
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_USER_PATH_SCRIPT],
            { stdin: "ignore", stderr: "ignore", env: overrides, extendEnv: true },
          ),
        );
        const [stdout, exitCode] = yield* Effect.all(
          [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
          { concurrency: "unbounded" },
        );
        if (exitCode !== 0) return yield* Effect.fail(`powershell exited with ${exitCode}`);
        return stdout;
      }),
    );
  // Explicit, so an inherited T3_SET=1 can never turn a read into a PATH write.
  const readUserPath = powershell({ T3_SET: "0" }).pipe(
    Effect.map((encoded) => Buffer.from(encoded.trim(), "base64").toString("utf8")),
    Effect.mapError(() => fail("Could not read your PATH, so it was left unchanged.")),
  );
  const writeUserPath = (value: string) =>
    powershell({ T3_SET: "1", T3_PATH: value }).pipe(
      Effect.asVoid,
      Effect.mapError(() => fail("Could not update your PATH.")),
    );

  /** `gs`, unless a `t3` link from before the rename is the installed one or another program owns `gs`. */
  const commandName = Effect.gen(function* () {
    if (windows || Option.isSome(yield* links.ourLinkIn("gs"))) return "gs" as const;
    return Option.isSome(yield* links.ourLinkIn("t3")) || Option.isSome(yield* links.gsTakenBy)
      ? ("t3" as const)
      : ("gs" as const);
  });
  /** The name Install links: `gs` when it is ours already or no other program owns it. */
  const installName = Effect.gen(function* () {
    if (windows || Option.isSome(yield* links.ourLinkIn("gs"))) return "gs" as const;
    return Option.isSome(yield* links.gsTakenBy) ? ("t3" as const) : ("gs" as const);
  });

  const installedAt = Effect.fn("DesktopCliCommand.installedAt")(function* (
    name: DesktopCliShim.CliCommandName,
  ) {
    if (windows) {
      if (!(yield* exists(ownedPathMarker))) return Option.none<string>();
      const entries = pathEntries(yield* readUserPath, ";");
      return entries.some((entry) => sameWindowsPath(entry, binDirectory))
        ? Option.some(launcher)
        : Option.none<string>();
    }
    return yield* links.ourLinkIn(name);
  });

  const startupLine = (installedPath: string) => {
    const setup = pathSetup({
      directory: path.dirname(installedPath),
      home: environment.homeDirectory,
      // A Finder or desktop launch may not set SHELL.
      shell: env.SHELL || readUserLoginShell(),
      platform: environment.platform,
      configHome: env.XDG_CONFIG_HOME,
      zdotdir: env.ZDOTDIR,
    });
    if (setup === undefined) return undefined;
    const file = setup.file.startsWith("~/")
      ? path.join(environment.homeDirectory, setup.file.slice(2))
      : setup.file;
    return { ...setup, path: file };
  };
  const hasLine = (setup: { readonly path: string; readonly line: string }) =>
    fs.readFileString(setup.path).pipe(
      Effect.map((content) => content.split("\n").some((line) => line.trim() === setup.line)),
      Effect.orElseSucceed(() => false),
    );

  const folderOnPath = (link: string) =>
    Effect.sync(() =>
      pathEntries(env.PATH, ":").some((entry) => entry.replace(/\/+$/, "") === path.dirname(link)),
    );

  const unsupported = {
    supported: false,
    installedPath: null,
    onPath: false,
    launcherPath: null,
    commandName: "gs",
  } as const;

  const state: DesktopCliCommand["Service"]["state"] = Effect.gen(function* () {
    if (!environment.isPackaged) return unsupported;
    const launcherPath = (yield* exists(launcher)) ? launcher : null;
    const name = yield* commandName;
    const found = yield* installedAt(name);
    // Our link into another home is not this app's command; Install updates it in place.
    const installed =
      windows || (Option.isSome(found) && (yield* links.leadsHere(found.value, name)))
        ? found
        : Option.none<string>();
    const shadowedBy = (yield* links.foreignFirstOnPath(name)).pipe(
      Option.filter((first) => first !== Option.getOrUndefined(found)),
    );
    const shadow = Option.isSome(shadowedBy) ? { shadowedBy: shadowedBy.value } : {};
    const first = yield* links.firstOnPath(name);
    const onPath = windows
      ? Option.isSome(installed)
      : Option.isSome(first) && (yield* links.runsOurLauncher(first.value, name));
    // Only a folder missing from PATH, with no other command first: with one, the added folder
    // (last on PATH) would still not run this one.
    const setup =
      onPath ||
      Option.isSome(shadowedBy) ||
      Option.isNone(installed) ||
      (yield* folderOnPath(installed.value))
        ? undefined
        : startupLine(installed.value);
    return {
      supported: true,
      installedPath: Option.getOrNull(installed),
      onPath,
      launcherPath,
      commandName: name,
      ...shadow,
      ...(setup === undefined
        ? {}
        : { pathSetup: { file: setup.file, added: yield* hasLine(setup) } }),
    };
  }).pipe(Effect.orElseSucceed(() => unsupported));

  const ensureLauncher = DesktopCliShim.install.pipe(
    Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(fail(`Could not set up the gs launcher at ${launcher}.`)),
        onSome: () => Effect.void,
      }),
    ),
  );

  const install: DesktopCliCommand["Service"]["install"] = Effect.gen(function* () {
    if (!environment.isPackaged) return yield* fail("The gs command needs an installed app.");
    yield* ensureLauncher;
    if (windows) {
      // PATH would split the folder at the `;`, leaving two wrong entries behind.
      if (binDirectory.includes(";")) {
        return yield* fail(
          `Gradespace IDE cannot put ${binDirectory} on PATH because it has a ";". Run ${launcher} directly.`,
        );
      }
      const entries = pathEntries(yield* readUserPath, ";");
      if (!entries.some((entry) => sameWindowsPath(entry, binDirectory))) {
        yield* writeUserPath([...entries, binDirectory].join(";"));
        yield* fs
          .writeFileString(ownedPathMarker, `${binDirectory}\n`)
          .pipe(Effect.mapError(() => fail("Added gs to your PATH but could not record it.")));
      }
      return yield* state;
    }
    const name = yield* installName;
    const target = links.launcherFor(name);
    const candidates = userCandidates(environment.homeDirectory);
    const replaced = Option.getOrUndefined(yield* installedAt(name));
    if (replaced !== undefined) {
      const current = yield* fs.readLink(replaced).pipe(Effect.option);
      if (Option.getOrUndefined(current) === target) return yield* state;
    }
    const shadowedBy = yield* links.foreignFirstOnPath(name);
    // Our own link into another home runs first too; it is the one this install updates.
    if (Option.isSome(shadowedBy) && shadowedBy.value !== replaced) {
      return yield* fail(
        `Another ${name} at ${shadowedBy.value} runs first in a new terminal. Remove it, or run the launcher directly at ${target}.`,
      );
    }
    // An old link of ours is updated where it is, so a command that works now keeps working. It
    // is removed only once a new link exists elsewhere.
    const onPath = pathEntries(env.PATH, ":").map((entry) => entry.replace(/\/+$/, ""));
    for (const directory of new Set([
      ...(replaced === undefined ? [] : [path.dirname(replaced)]),
      ...candidates.filter((candidate) => onPath.includes(candidate)),
      ...candidates.filter((candidate) => !onPath.includes(candidate)),
    ])) {
      const link = path.join(directory, name);
      const created = (yield* exists(directory))
        ? yield* links.writableDirectory(directory)
        : yield* fs.makeDirectory(directory, { recursive: true }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
      if (!created) continue;
      // Our own link, or a developer launcher, is swapped in place; anything else there makes
      // symlink fail and stays.
      const swap =
        link === replaced || ((yield* links.present(link)) && (yield* links.isReplaceable(link)));
      const staging = `${link}.${yield* Random.nextIntBetween(0, 0xffffff)}.tmp`;
      const linked = yield* (
        swap
          ? fs
              .symlink(target, staging)
              .pipe(
                Effect.andThen(
                  fs
                    .rename(staging, link)
                    .pipe(Effect.tapError(() => fs.remove(staging).pipe(Effect.ignore))),
                ),
              )
          : fs.symlink(target, link)
      ).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (!linked) continue;
      if (replaced !== undefined && replaced !== link) {
        yield* fs.remove(replaced).pipe(Effect.ignore);
      }
      return yield* state;
    }
    return yield* fail(
      `Another ${name} command is already in ~/.local/bin and ~/bin, or neither is writable. Run the launcher directly at ${target}.`,
    );
  }).pipe(Effect.withSpan("desktop.cliCommand.install"));

  const uninstall: DesktopCliCommand["Service"]["uninstall"] = Effect.gen(function* () {
    // A first launch put off for the shell PATH must not bring back what the user removed.
    yield* fs.writeFileString(firstLaunchMarker, "").pipe(Effect.ignore);
    if (windows) {
      if (yield* exists(ownedPathMarker)) {
        const entries = pathEntries(yield* readUserPath, ";");
        const kept = entries.filter((entry) => !sameWindowsPath(entry, binDirectory));
        if (kept.length !== entries.length) yield* writeUserPath(kept.join(";"));
        yield* fs.remove(ownedPathMarker).pipe(Effect.ignore);
      }
      return yield* state;
    }
    for (const directory of knownLocations(environment.homeDirectory, environment.platform)) {
      for (const name of ["gs", "t3"] as const) {
        const link = path.join(directory, name);
        if (yield* links.isOurLink(link)) {
          yield* fs.remove(link).pipe(Effect.mapError(() => fail(`Could not remove ${link}.`)));
        }
      }
    }
    return yield* state;
  }).pipe(Effect.withSpan("desktop.cliCommand.uninstall"));

  // One at a time, so Settings and onboarding cannot both append the line.
  const addToPathPermit = yield* Semaphore.make(1);
  const addToPath: DesktopCliCommand["Service"]["addToPath"] = Effect.gen(function* () {
    const name = yield* commandName;
    const installed = yield* installedAt(name);
    if (Option.isNone(installed) || !(yield* links.leadsHere(installed.value, name))) {
      return yield* fail(`Install the ${name} command first.`);
    }
    const setup = startupLine(installed.value);
    if (setup === undefined) {
      return yield* fail(`Gradespace IDE cannot add ${name} to this shell's PATH.`);
    }
    const shadowedBy = yield* links.foreignFirstOnPath(name);
    if (Option.isSome(shadowedBy)) {
      return yield* fail(
        `Another ${name} at ${shadowedBy.value} runs first; Gradespace IDE leaves it in place.`,
      );
    }
    if (!(yield* folderOnPath(installed.value)) && !(yield* hasLine(setup))) {
      yield* fs.makeDirectory(path.dirname(setup.path), { recursive: true }).pipe(
        Effect.andThen(
          fs.writeFileString(setup.path, `\n# Added by Gradespace IDE\n${setup.line}\n`, {
            flag: "a",
          }),
        ),
        Effect.mapError(() => fail(`Could not add ${name} to ${setup.file}.`)),
      );
    }
    return yield* state;
  }).pipe(addToPathPermit.withPermits(1), Effect.withSpan("desktop.cliCommand.addToPath"));

  const installOnFirstLaunch: DesktopCliCommand["Service"]["installOnFirstLaunch"] = Effect.gen(
    function* () {
      if (!environment.isPackaged || (yield* exists(firstLaunchMarker))) return;
      // Mark first so a failed or removed install is never retried behind the user's back.
      yield* fs.writeFileString(firstLaunchMarker, "");
      if (!freshInstall) {
        return yield* logInfo("left the gs command to Settings on an existing install");
      }
      const name = yield* installName;
      // Another home's app owns the existing link; only Install in Settings may take it over.
      const existing = Option.getOrUndefined(yield* installedAt(name));
      if (existing !== undefined) {
        const target = yield* fs.readLink(existing).pipe(Effect.option);
        if (Option.getOrUndefined(target) !== links.launcherFor(name)) {
          return yield* logInfo("left another Gradespace IDE app's command in place", {
            existing,
          });
        }
      }
      // A command that is not ours in these folders, even off PATH, means the user has one
      // already. On Windows the app never writes there, so any one there is someone else's.
      for (const directory of userCandidates(environment.homeDirectory)) {
        for (const file of windows ? [`${name}.cmd`, `${name}.exe`] : [name]) {
          const other = path.join(directory, file);
          const present =
            (yield* exists(other)) || Option.isSome(yield* fs.readLink(other).pipe(Effect.option));
          if (present && (windows || !(yield* links.isReplaceable(other)))) {
            return yield* logInfo("left the command to Settings beside another one", { other });
          }
        }
      }
      const installed = yield* install;
      yield* logInfo("installed the command on first launch", {
        commandName: installed.commandName,
        installedPath: installed.installedPath,
        onPath: installed.onPath,
      });
    },
  ).pipe(
    // Our own messages are short and name only paths; anything else is logged as a category.
    Effect.catch((error) =>
      logWarning("did not install the gs command on first launch", {
        reason: error._tag === "DesktopCliCommandError" ? error.message : "state-write-failed",
      }),
    ),
    Effect.withSpan("desktop.cliCommand.installOnFirstLaunch"),
  );

  return DesktopCliCommand.of({ state, install, uninstall, addToPath, installOnFirstLaunch });
});

export const layer = Layer.effect(DesktopCliCommand, make);
