import { describe, expect, it } from "vite-plus/test";

import {
  parseStudioManifest,
  studioVariantKind,
  withStudioComment,
  withStudioPicked,
  withStudioPickLine,
} from "./studioManifest";

const variant = (id: string, file = `${id.toLowerCase()}.html`) => ({ id, title: id, file });
const manifestJson = (variants: unknown, extra: object = {}) =>
  JSON.stringify({ title: "Launch", variants, ...extra });
const manifest = { title: "Launch", variants: [variant("A"), variant("B")] };
const setPath = ".gradespace/studio/launch";

describe("parseStudioManifest", () => {
  it("reads a valid set", () => {
    expect(parseStudioManifest(manifestJson([variant("A")], { recommended: "A" }))).toEqual({
      title: "Launch",
      recommended: "A",
      variants: [variant("A")],
    });
  });

  it.each([
    ["broken JSON", "{"],
    ["a non-object", "[]"],
    ["no variants", manifestJson([])],
    ["repeated ids", manifestJson([variant("A"), variant("A", "b.html")])],
    ["a parent path", manifestJson([variant("A", "../secret.html")])],
    ["a nested parent path", manifestJson([variant("A", "x/../../secret.html")])],
    ["an absolute path", manifestJson([variant("A", "/etc/passwd")])],
    ["a Windows path", manifestJson([variant("A", "C:\\secret.html")])],
    ["a backslash path", manifestJson([variant("A", "..\\secret.html")])],
  ])("rejects %s", (_name, contents) => {
    expect(parseStudioManifest(contents)).toBeNull();
  });
});

describe("withStudioPicked", () => {
  it("sets and clears the pick and keeps unknown fields", () => {
    const original = manifestJson([variant("A")], { skill: "gs-design" });
    const picked = withStudioPicked(original, "A")!;
    expect(JSON.parse(picked)).toMatchObject({ picked: "A", skill: "gs-design" });
    const cleared = JSON.parse(withStudioPicked(picked, null)!);
    expect(cleared).not.toHaveProperty("picked");
    expect(cleared.skill).toBe("gs-design");
  });

  it("refuses to overwrite a file it cannot read", () => {
    expect(withStudioPicked("{", "A")).toBeNull();
  });
});

describe("composer lines", () => {
  const [a, b] = manifest.variants;

  it("replaces an earlier pick and keeps what the user wrote", () => {
    const first = withStudioPickLine("Please hurry", manifest, setPath, a!);
    const second = withStudioPickLine(first, manifest, setPath, b!);
    expect(second).toBe(
      `Please hurry\nStudio pick for "Launch": option B, ${setPath}/b.html. Refine only this one.`,
    );
  });

  it("removes the pick line when the pick is cleared", () => {
    const picked = withStudioPickLine("Please hurry", manifest, setPath, a!);
    expect(withStudioPickLine(picked, manifest, setPath, null)).toBe("Please hurry");
  });

  it("keeps earlier comments when adding another", () => {
    const first = withStudioComment("", manifest, setPath, a!, " Bigger logo ");
    expect(withStudioComment(first, manifest, setPath, b!, "Less text")).toBe(
      `Studio comment on option A of "Launch" (${setPath}/a.html): Bigger logo\n` +
        `Studio comment on option B of "Launch" (${setPath}/b.html): Less text`,
    );
  });
});

describe("studioVariantKind", () => {
  it.each([
    ["a.html", "html"],
    ["a.PDF", "pdf"],
    ["a.png", "image"],
    ["a.md", "text"],
    ["a.txt", "text"],
    ["a.pptx", "other"],
  ])("%s is %s", (file, kind) => {
    expect(studioVariantKind(file)).toBe(kind);
  });
});
