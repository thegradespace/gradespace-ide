import { describe, expect, it } from "vite-plus/test";

import {
  parseStudioManifest,
  studioCompareDefault,
  studioPinLine,
  studioVariantKind,
  withStudioComment,
  withStudioFeedback,
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

describe("studioCompareDefault", () => {
  const three = { title: "Launch", variants: [variant("A"), variant("B"), variant("C")] };

  it("prefers the recommended option, else the next one, wrapping", () => {
    expect(studioCompareDefault({ ...three, recommended: "C" }, "A")?.id).toBe("C");
    expect(studioCompareDefault({ ...three, recommended: "A" }, "A")?.id).toBe("B");
    expect(studioCompareDefault(three, "C")?.id).toBe("A");
  });

  it("has nothing to compare a lone option with", () => {
    expect(studioCompareDefault({ title: "Launch", variants: [variant("A")] }, "A")?.id).toBe("A");
  });
});

describe("pinned comments", () => {
  const [, b] = manifest.variants;
  const anchored = {
    number: 2,
    comment: " make this\nbigger ",
    fx: 0.3,
    fy: 0.1,
    page: {
      x: 384,
      y: 150,
      width: 1280,
      height: 1000,
      selector: "main > a.cta",
      text: 'Get "started"',
    },
  };

  it("describes an anchored pin by its element and place on the page", () => {
    expect(studioPinLine(b!, anchored)).toBe(
      `Option B, pin 2 (near "Get 'started'" (main > a.cta), about 30% from the left and 15% from the top of the page): make this bigger`,
    );
  });

  it("falls back to the visible area without a bridge", () => {
    expect(studioPinLine(b!, { ...anchored, page: null, fx: 0.304, fy: 1.2 })).toBe(
      "Option B, pin 2 (about 30% from the left and 100% from the top of the visible area): make this bigger",
    );
  });

  it("appends the overall comment and pins after earlier lines", () => {
    expect(
      withStudioFeedback("Hi", manifest, setPath, b!, { comment: " Calmer ", pins: [anchored] }),
    ).toBe(
      `Hi\nStudio comments on option B of "Launch" (${setPath}/b.html):\n` +
        "Option B, overall: Calmer\n" +
        `Option B, pin 2 (near "Get 'started'" (main > a.cta), about 30% from the left and 15% from the top of the page): make this bigger`,
    );
  });

  it("matches the plain comment line when there are no pins", () => {
    expect(withStudioFeedback("", manifest, setPath, b!, { comment: "Calmer", pins: [] })).toBe(
      withStudioComment("", manifest, setPath, b!, "Calmer"),
    );
    expect(withStudioFeedback("Hi", manifest, setPath, b!, { comment: " ", pins: [] })).toBe("Hi");
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
