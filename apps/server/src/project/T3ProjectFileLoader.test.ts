import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(T3ProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-project-file-",
  });
});

const writeProjectFile = Effect.fn("writeProjectFile")(function* (
  cwd: string,
  contents: string,
  fileName = "t3.json",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, fileName), contents).pipe(Effect.orDie);
});

it.layer(layerTest)("T3ProjectFileLoader", (it) => {
  describe("load", () => {
    it.effect("returns none for malformed JSON without failing", () =>
      Effect.gen(function* () {
        const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, "{ not json");

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("reads gs.json over t3.json, falls back to t3.json, and never merges", () =>
      Effect.gen(function* () {
        const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
        const cwd = yield* makeTempDir;
        expect(Option.isNone(yield* loader.load(cwd))).toBe(true);

        yield* writeProjectFile(cwd, '{ "iconPath": "from-t3.svg" }');
        expect(Option.getOrNull(yield* loader.load(cwd))).toEqual({ iconPath: "from-t3.svg" });

        yield* writeProjectFile(cwd, '{ "worktreeSubmodules": "none" }', "gs.json");
        expect(Option.getOrNull(yield* loader.load(cwd))).toEqual({ worktreeSubmodules: "none" });

        yield* writeProjectFile(cwd, "{ not json", "gs.json");
        expect(Option.isNone(yield* loader.load(cwd))).toBe(true);
      }),
    );
  });

  describe("resolveProjectFilePath", () => {
    it.effect("names gs.json for a new file, and the existing file otherwise", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const resolve = T3ProjectFileLoader.resolveProjectFilePath(fileSystem, path, cwd);
        expect(yield* resolve).toBe(path.join(cwd, "gs.json"));

        yield* writeProjectFile(cwd, "{}");
        expect(yield* resolve).toBe(path.join(cwd, "t3.json"));

        yield* writeProjectFile(cwd, "{}", "gs.json");
        expect(yield* resolve).toBe(path.join(cwd, "gs.json"));
      }),
    );
  });
});
