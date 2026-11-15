import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";

import {
  findPosixLauncher,
  launcherOwnsVersionsDir,
  pinnedRuntimeVersionsDir,
  recordPinnedRuntimeLauncher,
  windowsShimTarget,
  writePosixLauncher,
} from "../cloud/pinnedRuntime.ts";

export class CliUpdateError extends Schema.TaggedError<CliUpdateError>()("CliUpdateError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason;
  }
}

/**
 * Only a launcher that already points into this home's `runtime/versions` tree is touched; a
 * plain copy of the executable, or a launcher for some other install, is left alone. It is
 * recorded before it moves, so prune never meets a repointed launcher it does not know about.
 */
export const repointLauncher = Effect.fn("cli.update.repoint_launcher")(function* (input: {
  readonly launchedAs: string | undefined;
  readonly baseDir: string;
  readonly targetEntryPath: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  if (input.launchedAs === undefined) return Option.none<string>();
  const versionsDir = pinnedRuntimeVersionsDir(path, input.baseDir);
  const ownsTarget = (candidate: string) => launcherOwnsVersionsDir(path, versionsDir, candidate);
  const remember = (launcher: string) =>
    recordPinnedRuntimeLauncher({ baseDir: input.baseDir, launcher }).pipe(
      Effect.mapError(
        () => new CliUpdateError({ reason: `Could not record the t3 launcher at ${launcher}.` }),
      ),
    );

  if (platform === "win32") {
    const shimPath = yield* findWindowsShim(input.launchedAs);
    if (shimPath === undefined) return Option.none<string>();
    const current = yield* fs.readFileString(shimPath).pipe(Effect.option);
    const quoted = Option.isSome(current) ? windowsShimTarget(current.value) : undefined;
    if (quoted === undefined || !ownsTarget(quoted)) return Option.none<string>();
    yield* remember(shimPath);
    yield* fs
      .writeFileString(shimPath, `@echo off\r\n"${input.targetEntryPath}" %*`)
      .pipe(
        Effect.mapError(
          () => new CliUpdateError({ reason: `Could not rewrite the t3 launcher at ${shimPath}.` }),
        ),
      );
    return Option.some(shimPath);
  }

  const launcher = yield* findPosixLauncher({ launchedAs: input.launchedAs, versionsDir });
  if (launcher === undefined) return Option.none<string>();
  yield* remember(launcher);
  yield* writePosixLauncher({
    launcher,
    executable: input.targetEntryPath,
    exclusive: false,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CliUpdateError({ reason: `Could not repoint the t3 launcher at ${launcher}.`, cause }),
    ),
  );
  return Option.some(launcher);
});

/** Windows executables see their own path, so find the installer shim by matching t3.cmd targets on PATH. */
export const findWindowsShim = Effect.fn("cli.update.find_windows_shim")(function* (
  executablePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const candidates = [
    ...(environment["T3CODE_INSTALL_BIN_DIR"] ? [environment["T3CODE_INSTALL_BIN_DIR"]] : []),
    ...(environment["PATH"] ?? environment["Path"] ?? "").split(";"),
  ].filter((entry) => entry.trim().length > 0);
  for (const directory of candidates) {
    const shimPath = path.join(directory, "t3.cmd");
    const contents = yield* fs.readFileString(shimPath).pipe(Effect.option);
    if (Option.isNone(contents)) continue;
    const target = windowsShimTarget(contents.value);
    if (
      target !== undefined &&
      path.resolve(target).toLowerCase() === path.resolve(executablePath).toLowerCase()
    ) {
      return shimPath;
    }
  }
  return undefined;
});

const CLI_UPDATE_UNAVAILABLE_MESSAGE =
  "Gradespace IDE does not publish CLI builds, so `gs update` has nothing to install. Update Gradespace IDE through the Mac app, or download the latest version from https://thegradespace.com/ide.";

export const updateCommand = Command.make("update", {
  args: Argument.String("args").pipe(Argument.variadic),
}).pipe(
  Command.withDescription("Not available: Gradespace IDE updates through the Mac app."),
  Command.withHandler(() =>
    Effect.fail(new CliUpdateError({ reason: CLI_UPDATE_UNAVAILABLE_MESSAGE })),
  ),
);
