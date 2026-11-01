#!/usr/bin/env node
// Installs `gs`: runs this checkout's CLI from source against the dev state (~/.t3/dev).
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";

import * as HostProcess from "@t3tools/shared/HostProcess";

export class ForeignLauncherError extends Schema.TaggedError<ForeignLauncherError>()(
  "ForeignLauncherError",
  { file: Schema.String },
) {
  override get message(): string {
    return `${this.file} already exists and was not installed by this script.`;
  }
}

const MARKER = "# Installed by scripts/install-gs-command.ts";
// /usr/local/bin is on PATH on macOS; ~/.local/bin is the fallback when it is not writable.
const CANDIDATE_DIRS = ["/usr/local/bin"];

/** The dev web URL makes the server pick `<home>/dev` instead of `<home>/userdata` (config.ts deriveServerPaths). */
export function renderLauncher(input: {
  readonly nodePath: string;
  readonly entryPath: string;
  readonly devUrl: string;
}): string {
  return [
    "#!/bin/sh",
    MARKER,
    `export VITE_DEV_SERVER_URL="\${VITE_DEV_SERVER_URL:-${input.devUrl}}"`,
    `exec "${input.nodePath}" "${input.entryPath}" "$@"`,
    "",
  ].join("\n");
}

const resolveInstallPath = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const dir of CANDIDATE_DIRS) {
    const writable = yield* fs.access(dir, { writable: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (writable) return { file: path.join(dir, "gs"), onPath: true };
  }
  const home = (yield* HostProcess.Environment).HOME ?? "";
  const dir = path.join(home, ".local/bin");
  yield* fs.makeDirectory(dir, { recursive: true });
  return { file: path.join(dir, "gs"), onPath: false };
});

const isOurs = Effect.fn("install-gs-command.isOurs")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(file).pipe(
    Effect.map((content) => content.includes(MARKER)),
    Effect.orElseSucceed(() => false),
  );
});

const install = Effect.fn("install-gs-command.install")(function* (devUrl: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const target = yield* resolveInstallPath;
  if ((yield* fs.exists(target.file)) && !(yield* isOurs(target.file))) {
    return yield* new ForeignLauncherError({ file: target.file });
  }
  yield* fs.writeFileString(
    target.file,
    renderLauncher({
      nodePath: yield* HostProcess.ExecutablePath,
      entryPath: path.join(repoRoot, "apps/server/src/bin.ts"),
      devUrl,
    }),
  );
  yield* fs.chmod(target.file, 0o755);
  yield* Console.log(`Installed gs at ${target.file}. It runs ${repoRoot} against ~/.t3/dev.`);
  if (!target.onPath) {
    yield* Console.log(`Add it to your PATH: export PATH="${path.dirname(target.file)}:$PATH"`);
  }
});

const uninstall = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = (yield* HostProcess.Environment).HOME ?? "";
  const files = [...CANDIDATE_DIRS, path.join(home, ".local/bin")].map((dir) =>
    path.join(dir, "gs"),
  );
  for (const file of files) {
    if (yield* isOurs(file)) {
      yield* fs.remove(file);
      yield* Console.log(`Removed ${file}.`);
    }
  }
});

const command = Command.make("install-gs-command", {
  uninstall: Flag.Boolean("uninstall").pipe(
    Flag.withDescription("Remove the gs launcher."),
    Flag.withDefault(false),
  ),
  devUrl: Flag.String("dev-url").pipe(
    Flag.withDescription("The dev web URL, which selects the dev state."),
    Flag.withDefault("http://localhost:5733"),
  ),
}).pipe(Command.withHandler((flags) => (flags.uninstall ? uninstall : install(flags.devUrl))));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
