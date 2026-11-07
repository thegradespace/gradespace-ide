// @effect-diagnostics-next-line nodeBuiltinImport:off -- FileSystem.access has no execute check.
import * as NodeFSP from "node:fs/promises";

import type { DesktopCliCommandState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopCliShim from "./DesktopCliShim.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export class DesktopCliCommandError extends Schema.TaggedError<DesktopCliCommandError>()(
  "DesktopCliCommandError",
  { message: Schema.String },
) {}

const unixCandidates = (home: string, platform: NodeJS.Platform) =>
  platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/bin`]
    : [`${home}/.local/bin`, `${home}/bin`];

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
  }
>()("@t3tools/desktop/app/DesktopCliCommand") {}

/** PATH links to the app's launchers on macOS and Linux. */
const makeLinks = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = environment.path;
  const candidates = unixCandidates(environment.homeDirectory, environment.platform);
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
    function* (candidate: string, name: DesktopCliShim.CliCommandName) {
      if (yield* isOurLink(candidate)) return true;
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
      yield* Effect.tryPromise(() => NodeFSP.access(target, NodeFSP.constants.X_OK));
      return true;
    },
    Effect.orElseSucceed(() => false),
  );

  const firstOnPath = Effect.fn("DesktopCliCommand.firstOnPath")(function* (
    name: DesktopCliShim.CliCommandName,
  ) {
    for (const directory of pathEntries(process.env.PATH, ":")) {
      const candidate = path.join(directory, name);
      if (yield* isExecutableFile(candidate)) return Option.some(candidate);
    }
    return Option.none<string>();
  });

  const foreignFirstOnPath = Effect.fn("DesktopCliCommand.foreignFirstOnPath")(function* (
    name: DesktopCliShim.CliCommandName,
  ) {
    const first = yield* firstOnPath(name);
    if (Option.isNone(first)) return first;
    if ((yield* runsOurLauncher(first.value, name)) || (yield* isReplaceable(first.value))) {
      return Option.none<string>();
    }
    return first;
  });

  /** Ghostscript installs `gs`; ours would shadow it or be shadowed, so the command falls back to `t3`. */
  const gsTakenBy = Effect.gen(function* () {
    for (const directory of candidates) {
      const candidate = path.join(directory, "gs");
      if ((yield* present(candidate)) && !(yield* isReplaceable(candidate))) {
        return Option.some(candidate);
      }
    }
    for (const directory of pathEntries(process.env.PATH, ":")) {
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
    for (const directory of candidates) {
      const link = path.join(directory, name);
      if (yield* isOurLink(link)) return Option.some(link);
    }
    return Option.none<string>();
  });

  const placeLink = Effect.fn("DesktopCliCommand.placeLink")(function* (
    name: DesktopCliShim.CliCommandName,
    directories: ReadonlyArray<string>,
  ) {
    for (const directory of directories) {
      const link = path.join(directory, name);
      if (yield* present(link)) {
        if (!(yield* isReplaceable(link))) continue;
        const removed = yield* fs.remove(link).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (!removed) continue;
      }
      const created = (yield* exists(directory))
        ? yield* writableDirectory(directory)
        : yield* fs.makeDirectory(directory, { recursive: true }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
      if (!created) continue;
      const linked = yield* fs.symlink(launcherFor(name), link).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (linked) return Option.some(link);
    }
    return Option.none<string>();
  });

  return {
    candidates,
    launcherFor,
    isOurLink,
    runsOurLauncher,
    firstOnPath,
    foreignFirstOnPath,
    gsTakenBy,
    ourLinkIn,
    placeLink,
  };
});

/** Adds `gs` beside a `t3` link from before the rename when no other `gs` is there or on PATH. */
export const handover = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (!environment.isPackaged || environment.platform === "win32") return Option.none<string>();
  const links = yield* makeLinks;
  if (Option.isSome(yield* links.ourLinkIn("gs"))) return Option.none<string>();
  const t3 = yield* links.ourLinkIn("t3");
  if (Option.isNone(t3) || Option.isSome(yield* links.gsTakenBy)) return Option.none<string>();
  return yield* links.placeLink("gs", [environment.path.dirname(t3.value)]);
}).pipe(Effect.withSpan("desktop.cliCommand.handover"));

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = environment.path;
  const windows = environment.platform === "win32";
  const launcher = DesktopCliShim.launcherPath(environment);
  const binDirectory = path.dirname(launcher);
  const ownedPathMarker = path.join(environment.stateDir, "cli-command-path-entry");
  const links = yield* makeLinks;

  const fail = (message: string) => new DesktopCliCommandError({ message });
  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));

  const powershell = (env: Record<string, string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = process.env.SystemRoot ?? process.env.WINDIR;
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_USER_PATH_SCRIPT],
            { stdin: "ignore", stderr: "ignore", env, extendEnv: true },
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
  const readUserPath = powershell({}).pipe(
    Effect.map((encoded) => Buffer.from(encoded.trim(), "base64").toString("utf8")),
    Effect.mapError(() => fail("Could not read your PATH, so it was left unchanged.")),
  );
  const writeUserPath = (value: string) =>
    powershell({ T3_SET: "1", T3_PATH: value }).pipe(
      Effect.asVoid,
      Effect.mapError(() => fail("Could not update your PATH.")),
    );

  const windowsInstalled = Effect.gen(function* () {
    if (!(yield* exists(ownedPathMarker))) return Option.none<string>();
    const entries = pathEntries(yield* readUserPath, ";");
    return entries.some((entry) => sameWindowsPath(entry, binDirectory))
      ? Option.some(launcher)
      : Option.none<string>();
  });

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
    if (windows) {
      const installed = yield* windowsInstalled;
      return {
        supported: true,
        installedPath: Option.getOrNull(installed),
        onPath: Option.isSome(installed),
        launcherPath,
        commandName: "gs",
      } as const;
    }
    const gs = yield* links.ourLinkIn("gs");
    const t3 = Option.isSome(gs) ? Option.none<string>() : yield* links.ourLinkIn("t3");
    const commandName: DesktopCliShim.CliCommandName =
      Option.isNone(gs) && (Option.isSome(t3) || Option.isSome(yield* links.gsTakenBy))
        ? "t3"
        : "gs";
    const shadowedBy = yield* links.foreignFirstOnPath(commandName);
    const shadow = Option.isSome(shadowedBy) ? { shadowedBy: shadowedBy.value } : {};
    const first = yield* links.firstOnPath(commandName);
    const onPath = Option.isSome(first) && (yield* links.runsOurLauncher(first.value, commandName));
    return {
      supported: true,
      installedPath: Option.getOrNull(Option.orElse(gs, () => t3)),
      onPath,
      launcherPath,
      commandName,
      ...shadow,
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
      const entries = pathEntries(yield* readUserPath, ";");
      if (!entries.some((entry) => sameWindowsPath(entry, binDirectory))) {
        yield* writeUserPath([...entries, binDirectory].join(";"));
        yield* fs
          .writeFileString(ownedPathMarker, `${binDirectory}\n`)
          .pipe(Effect.mapError(() => fail("Added gs to your PATH but could not record it.")));
      }
      return yield* state;
    }
    const name: DesktopCliShim.CliCommandName = Option.isSome(yield* links.gsTakenBy) ? "t3" : "gs";
    const target = links.launcherFor(name);
    const existing = yield* links.ourLinkIn(name);
    if (Option.isSome(existing)) {
      const current = yield* fs.readLink(existing.value).pipe(Effect.option);
      if (Option.getOrUndefined(current) === target) return yield* state;
      yield* fs
        .remove(existing.value)
        .pipe(Effect.mapError(() => fail(`Could not replace ${existing.value}.`)));
    }
    const shadowedBy = yield* links.foreignFirstOnPath(name);
    if (Option.isSome(shadowedBy)) {
      return yield* fail(
        `Another ${name} at ${shadowedBy.value} runs first in a new terminal. Remove it, or run the launcher directly at ${launcher}.`,
      );
    }
    const onPath = pathEntries(process.env.PATH, ":");
    const placed = yield* links.placeLink(name, [
      ...links.candidates.filter((candidate) => onPath.includes(candidate)),
      ...links.candidates.filter((candidate) => !onPath.includes(candidate)),
    ]);
    if (Option.isSome(placed)) return yield* state;
    return yield* fail(
      `Another ${name} command is already installed, or no folder on your PATH is writable. Run the launcher directly at ${launcher}.`,
    );
  }).pipe(Effect.withSpan("desktop.cliCommand.install"));

  const uninstall: DesktopCliCommand["Service"]["uninstall"] = Effect.gen(function* () {
    if (windows) {
      if (yield* exists(ownedPathMarker)) {
        const entries = pathEntries(yield* readUserPath, ";");
        const kept = entries.filter((entry) => !sameWindowsPath(entry, binDirectory));
        if (kept.length !== entries.length) yield* writeUserPath(kept.join(";"));
        yield* fs.remove(ownedPathMarker).pipe(Effect.ignore);
      }
      return yield* state;
    }
    for (const directory of links.candidates) {
      for (const name of ["gs", "t3"] as const) {
        const link = path.join(directory, name);
        if (yield* links.isOurLink(link)) {
          yield* fs.remove(link).pipe(Effect.mapError(() => fail(`Could not remove ${link}.`)));
        }
      }
    }
    return yield* state;
  }).pipe(Effect.withSpan("desktop.cliCommand.uninstall"));

  return DesktopCliCommand.of({ state, install, uninstall });
});

export const layer = Layer.effect(DesktopCliCommand, make);
