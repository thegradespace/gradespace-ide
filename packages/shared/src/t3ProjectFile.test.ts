import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import type { ProjectReadFileResult } from "@t3tools/contracts";

import {
  parseT3ProjectFile,
  pickProjectFileRead,
  resolveProjectFileName,
  T3ProjectFileFromJson,
} from "./t3ProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(T3ProjectFileFromJson);

describe("T3ProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", "stopOnSettle": true, },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev", stopOnSettle: true });
  });
});

describe("parseT3ProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parseT3ProjectFile(`{
        /* See https://thegradespace.com/schema/gs.json */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });
});

describe("resolveProjectFileName", () => {
  const present =
    (...names: string[]) =>
    (name: string) =>
      names.includes(name);

  it("prefers gs.json, falls back to t3.json, and names gs.json for a new file", () => {
    expect(resolveProjectFileName(present("gs.json", "t3.json"))).toBe("gs.json");
    expect(resolveProjectFileName(present("gs.json"))).toBe("gs.json");
    expect(resolveProjectFileName(present("t3.json"))).toBe("t3.json");
    expect(resolveProjectFileName(present())).toBe("gs.json");
  });
});

describe("pickProjectFileRead", () => {
  const read = (relativePath: string, exists?: boolean): ProjectReadFileResult => ({
    relativePath,
    contents: "{}",
    byteLength: 2,
    truncated: false,
    ...(exists === undefined ? {} : { exists }),
  });

  it("uses gs.json alone when both exist, and t3.json when gs.json is missing", () => {
    const gs = read("gs.json");
    const t3 = read("t3.json", true);
    expect(pickProjectFileRead({ "gs.json": gs, "t3.json": t3 })).toBe(gs);
    expect(pickProjectFileRead({ "gs.json": read("gs.json", false), "t3.json": t3 })).toBe(t3);
    expect(pickProjectFileRead({ "gs.json": null, "t3.json": t3 })).toBe(t3);
  });

  it("returns null when neither file exists", () => {
    expect(
      pickProjectFileRead({ "gs.json": read("gs.json", false), "t3.json": read("t3.json", false) }),
    ).toBeNull();
    expect(pickProjectFileRead({ "gs.json": null, "t3.json": null })).toBeNull();
  });
});
