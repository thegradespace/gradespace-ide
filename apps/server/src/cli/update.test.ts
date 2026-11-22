import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { Command } from "effect/cli";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  posixLauncherScript,
  prunePinnedRuntimes,
  readPosixLauncherTarget,
  resolveLauncherPath,
} from "../cloud/pinnedRuntime.ts";
import * as ProcessRunner from "../processRunner.ts";
import { repointLauncher, updateCommand } from "./update.ts";

// lsof listing one process, so prune sees a process list in which no runtime is running.
const unrelatedLsof = ProcessRunner.ProcessRunner.of({
  run: () =>
    Effect.succeed({
      stdout: "p1\nftxt\nn/usr/bin/true\n",
      stderr: "",
      code: ChildProcessSpawner.ExitCode(0),
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    }),
});

it.effect("refuses to update because Gradespace publishes no CLI builds", () =>
  Effect.gen(function* () {
    const error = yield* Command.runWith(updateCommand, { version: "0.0.0" })(["0.0.42"]).pipe(
      Effect.flip,
    );
    assert.include(error.message, "Mac app");
    assert.include(error.message, "https://thegradespace.com/ide");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.layer(NodeServices.layer)("t3 update launcher", (it) => {
  it.effect("replaces a legacy symlink with a script that execs the new version", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const oldExe = path.join(root, "runtime/versions/1.0.0/t3");
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const launcher = path.join(root, "bin/t3");
      for (const file of [oldExe, newExe]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.symlink(oldExe, launcher);

      const repointed = yield* repointLauncher({
        launchedAs: launcher,
        baseDir: root,
        targetEntryPath: newExe,
      });

      assert.deepStrictEqual(Option.getOrUndefined(repointed), launcher);
      assert.equal(yield* fs.readFileString(launcher), posixLauncherScript(newExe));
      // Replaced, not written through.
      assert.equal(yield* fs.readFileString(oldExe), "");
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("repoints a recorded Windows launcher outside PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const baseDir = path.join(root, "home");
      const runtimeDir = path.join(baseDir, "runtime");
      const launcher = path.join(root, "custom bin", "t3.cmd");
      const launchedAs = path.join(runtimeDir, "versions", "1.0.0", "t3.exe");
      const targetEntryPath = path.join(runtimeDir, "versions", "2.0.0", "t3.exe");
      yield* fs.makeDirectory(runtimeDir, { recursive: true });
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, `@echo off\r\n"${launchedAs}" %*`);
      yield* fs.writeFileString(path.join(runtimeDir, "launchers"), `${launcher}\r\n`);

      const repointed = yield* repointLauncher({ launchedAs, baseDir, targetEntryPath });

      assert.equal(Option.getOrUndefined(repointed), launcher);
      assert.equal(yield* fs.readFileString(launcher), `@echo off\r\n"${targetEntryPath}" %*`);
    }).pipe(
      Effect.scoped,
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, { PATH: "" }),
    ),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "finds the script that ran this executable and rewrites it, keeping aliases and arguments",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" }),
        );
        // A quote and a space in the home path exercise the script's quoting.
        const home = path.join(root, "it's home");
        const entry = (version: string) => path.join(home, "runtime/versions", version, "t3");
        for (const version of ["1.0.0", "2.0.0"]) {
          yield* fs.makeDirectory(path.dirname(entry(version)), { recursive: true });
          yield* fs.writeFileString(entry(version), '#!/bin/sh\nprintf \'[%s]\\n\' "$0" "$@"\n', {
            mode: 0o755,
          });
        }
        const launcher = path.join(root, "bin/t3");
        const alias = path.join(root, "alias/t3");
        yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
        yield* fs.makeDirectory(path.dirname(alias), { recursive: true });
        yield* fs.writeFileString(launcher, posixLauncherScript(entry("1.0.0")), { mode: 0o755 });
        yield* fs.symlink(launcher, alias);
        const repoint = (environment: Record<string, string>) =>
          repointLauncher({
            // The script execs by absolute path, so argv0 names the executable.
            launchedAs: entry("1.0.0"),
            baseDir: home,
            targetEntryPath: entry("2.0.0"),
          }).pipe(Effect.provideService(HostProcess.Environment, environment));

        assert.equal(
          Option.getOrUndefined(yield* repoint({ PATH: path.dirname(alias) })),
          launcher,
        );
        assert.equal(yield* fs.readLink(alias), launcher);
        const args = ["two words", "it's quoted", "", "*", "$HOME"];
        assert.equal(
          yield* spawner.string(ChildProcess.make(alias, args, { cwd: root })),
          [entry("2.0.0"), ...args].map((arg) => `[${arg}]\n`).join(""),
        );

        // Like the shell, a relative PATH entry resolves from the working directory, and a
        // script nobody can execute is passed over.
        const unrunnable = path.join(root, "unrunnable/t3");
        yield* fs.makeDirectory(path.dirname(unrunnable), { recursive: true });
        yield* fs.writeFileString(unrunnable, posixLauncherScript(entry("2.0.0")), { mode: 0o644 });
        yield* fs.writeFileString(launcher, posixLauncherScript(entry("2.0.0")), { mode: 0o755 });
        const relative = yield* repointLauncher({
          launchedAs: entry("2.0.0"),
          baseDir: home,
          targetEntryPath: entry("1.0.0"),
        }).pipe(
          Effect.provideService(HostProcess.Environment, {
            PATH: `${path.dirname(unrunnable)}:bin`,
          }),
          Effect.provideService(HostProcess.WorkingDirectory, root),
        );
        assert.equal(Option.getOrUndefined(relative), launcher);
        assert.equal(yield* fs.readFileString(unrunnable), posixLauncherScript(entry("2.0.0")));

        // An edited script is the user's own wrapper now.
        const edited = `${posixLauncherScript(entry("1.0.0"))}# mine\n`;
        yield* fs.writeFileString(launcher, edited);
        assert.isTrue(Option.isNone(yield* repoint({ PATH: path.dirname(launcher) })));
        assert.equal(yield* fs.readFileString(launcher), edited);
      }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect.each([
    { name: "no launcher records", recorded: undefined },
    { name: "an empty launcher record", recorded: "" },
    { name: "whole launcher records", recorded: "/opt/t3\n" },
    { name: "Windows launcher records", recorded: "C:\\t3.cmd\r\n" },
    // An interrupted append cut this record short.
    { name: "an unterminated launcher record", recorded: "/opt/t" },
    // Another process's append is cut short after t3 update reads the records.
    { name: "a record cut short after the read", recorded: "/opt/t3\n", cut: "/opt/t" },
  ])("keeps the runtime a repointed launcher off PATH points at with $name", ({ recorded, cut }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      yield* TestClock.setTime(Duration.toMillis(Duration.days(1)));
      for (const version of ["1.0.0", "2.0.0"]) {
        const directory = path.join(root, "runtime/versions", version);
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(path.join(directory, "t3"), "");
        yield* fs.writeFileString(path.join(directory, ".install-complete"), `${version}\n`);
        yield* fs.utimes(path.join(directory, ".install-complete"), 0, 0);
      }
      if (recorded !== undefined) {
        yield* fs.writeFileString(path.join(root, "runtime/launchers"), recorded);
      }
      // A launcher in the T3 home itself, which neither PATH nor the default bin dir reaches.
      const launcher = path.join(root, "t3");
      yield* fs.symlink(path.join(root, "runtime/versions/1.0.0/t3"), launcher);

      const launchersFile = path.join(root, "runtime/launchers");
      yield* repointLauncher({
        launchedAs: launcher,
        baseDir: root,
        targetEntryPath: path.join(root, "runtime/versions/2.0.0/t3"),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: (file, encoding) =>
            fs
              .readFileString(file, encoding)
              .pipe(
                Effect.tap(() =>
                  cut === undefined || file !== launchersFile
                    ? Effect.void
                    : fs.writeFileString(file, cut, { flag: "a" }),
                ),
              ),
        }),
      );
      // A later server start prunes with no idea how this machine launches t3.
      const removed = yield* prunePinnedRuntimes({ baseDir: root, keep: [] }).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, unrelatedLsof),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, { PATH: "" }),
        Effect.provideService(HostProcess.HomeDirectory, root),
      );

      assert.deepStrictEqual(removed, ["1.0.0"]);
      assert.equal(
        yield* readPosixLauncherTarget(launcher),
        path.join(root, "runtime/versions/2.0.0/t3"),
      );
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  const launcherFixture = Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
    const oldExe = path.join(root, "runtime/versions/1.0.0/t3");
    const newExe = path.join(root, "runtime/versions/2.0.0/t3");
    const launcher = path.join(root, "t3");
    for (const file of [oldExe, newExe]) {
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, "");
    }
    yield* fs.symlink(oldExe, launcher);
    return { root, oldExe, newExe, launcher, launchersFile: path.join(root, "runtime/launchers") };
  });

  it.effect("records a relative launcher path as absolute", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, newExe, launcher, launchersFile } = yield* launcherFixture();

      yield* repointLauncher({
        launchedAs: path.relative(path.resolve("."), launcher),
        baseDir: root,
        targetEntryPath: newExe,
      });

      assert.equal(yield* fs.readFileString(launchersFile), `\n${launcher}\n`);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("fails instead of repointing a launcher it cannot record", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { root, oldExe, newExe, launcher, launchersFile } = yield* launcherFixture();
      // Appending to a directory fails the way a read-only or full disk would.
      yield* fs.makeDirectory(launchersFile);

      const result = yield* repointLauncher({
        launchedAs: launcher,
        baseDir: root,
        targetEntryPath: newExe,
      }).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(result));
      assert.equal(yield* fs.readLink(launcher), oldExe);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect.each(["recording", "repointing"] as const)(
    "never leaves a repointed launcher unrecorded when t3 update dies while %s",
    (step) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { root, newExe, launcher, launchersFile } = yield* launcherFixture();

        yield* repointLauncher({
          launchedAs: launcher,
          baseDir: root,
          targetEntryPath: newExe,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            writeFileString: (path, data, options) =>
              step === "recording" && path === launchersFile
                ? Effect.die("t3 update was killed")
                : fs.writeFileString(path, data, options),
            rename: (from, to) =>
              step === "repointing" && to === launcher
                ? Effect.die("t3 update was killed")
                : fs.rename(from, to),
          }),
          Effect.exit,
        );

        const repointed = (yield* readPosixLauncherTarget(launcher)) === newExe;
        const recorded = (yield* fs
          .readFileString(launchersFile)
          .pipe(Effect.orElseSucceed(() => "")))
          .split("\n")
          .includes(launcher);
        assert.isFalse(repointed && !recorded);
      }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("leaves a plain copy or a foreign symlink alone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const copy = path.join(root, "copy/t3");
      const foreign = path.join(root, "foreign/t3");
      const elsewhere = path.join(root, "elsewhere/t3");
      const otherHome = path.join(root, "other/runtime/versions/1.0.0/t3");
      const otherLauncher = path.join(root, "other/bin/t3");
      for (const file of [newExe, copy, elsewhere, otherHome]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
      yield* fs.symlink(elsewhere, foreign);
      yield* fs.makeDirectory(path.dirname(otherLauncher), { recursive: true });
      yield* fs.symlink(otherHome, otherLauncher);

      for (const launchedAs of [copy, foreign, otherLauncher, undefined]) {
        const repointed = yield* repointLauncher({
          launchedAs,
          baseDir: root,
          targetEntryPath: newExe,
        });
        assert.equal(repointed._tag, "None", launchedAs ?? "undefined");
      }
      assert.equal(yield* fs.readLink(foreign), elsewhere);
      assert.equal(yield* fs.readLink(otherLauncher), otherHome);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("finds the launcher a bare command name resolved to on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const delimiter = (yield* HostProcess.Platform) === "win32" ? ";" : ":";
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const launcher = path.join(root, "bin/t3");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, "", { mode: 0o755 });

      const bare = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "t3"),
        Effect.provideService(HostProcess.Environment, {
          PATH: [path.join(root, "missing"), path.join(root, "bin")].join(delimiter),
        }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const relative = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "./bin/t3"),
        Effect.provideService(HostProcess.Environment, { PATH: "" }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const absent = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "t3"),
        Effect.provideService(HostProcess.Environment, { PATH: path.join(root, "missing") }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );

      assert.equal(bare, launcher);
      assert.equal(relative, launcher);
      assert.equal(absent, undefined);
    }),
  );
});
