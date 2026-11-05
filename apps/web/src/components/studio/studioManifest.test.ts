import { describe, expect, it } from "vite-plus/test";

import {
  parseStudioManifest,
  studioCompareDefault,
  studioDownloadFileName,
  studioPinLine,
  studioShownVariant,
  studioVariantKind,
  studioViewedVersion,
  withStudioComment,
  withStudioFeedback,
  withStudioPicked,
  withStudioPickLine,
  withStudioRestoreLine,
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

describe("revisions", () => {
  const revisions = [
    { file: "b.v1.html", note: "first draft", createdAt: "2026-11-03T10:00:00Z" },
    { file: "b.v2.html" },
  ];

  it("reads earlier versions, oldest first", () => {
    const parsed = parseStudioManifest(manifestJson([{ ...variant("B"), revisions }]));
    expect(parsed?.variants[0]?.revisions).toEqual(revisions);
  });

  it("ignores a malformed entry and keeps the set", () => {
    const parsed = parseStudioManifest(
      manifestJson([
        {
          ...variant("B"),
          revisions: [
            "b.v1.html",
            null,
            { note: "no file" },
            { file: 3 },
            { file: "../secret.html" },
            { file: "/etc/passwd" },
            { file: "b.v2.html", note: 7, createdAt: false },
            { file: "b.v3.html", note: "ok" },
          ],
        },
      ]),
    );
    expect(parsed?.variants[0]?.revisions).toEqual([
      { file: "b.v2.html" },
      { file: "b.v3.html", note: "ok" },
    ]);
  });

  it.each([
    ["not a list", "b.v1.html"],
    ["an empty list", []],
    ["an object", {}],
  ])("treats revisions as absent when it is %s", (_name, value) => {
    const parsed = parseStudioManifest(manifestJson([{ ...variant("B"), revisions: value }]));
    expect(parsed).toEqual({ title: "Launch", variants: [variant("B")] });
  });

  it("numbers earlier versions from 1 and falls back to the latest", () => {
    const b = { ...variant("B"), revisions };
    expect(studioViewedVersion(b, 1)).toBe(1);
    expect(studioViewedVersion(b, 2)).toBe(2);
    expect(studioViewedVersion(b, 3)).toBeNull();
    expect(studioViewedVersion(b, 0)).toBeNull();
    expect(studioViewedVersion(b, undefined)).toBeNull();
    expect(studioViewedVersion(variant("A"), 1)).toBeNull();
    expect(studioShownVariant(b, 2).file).toBe("b.v2.html");
    expect(studioShownVariant(b, null)).toBe(b);
  });

  it("names downloads after the set and option, with the version once there are several", () => {
    const set = ".gradespace/studio/2026-11-05-launch";
    const b = { ...variant("B"), revisions };
    expect(studioDownloadFileName(set, variant("A"), null, "png")).toBe("2026-11-05-launch-A.png");
    expect(studioDownloadFileName(set, b, null, "pdf")).toBe("2026-11-05-launch-B-v3.pdf");
    expect(studioDownloadFileName(set, b, 1, "html")).toBe("2026-11-05-launch-B-v1.html");
    expect(studioDownloadFileName("studio/my set!", variant("a/b c"), null, "png")).toBe(
      "my-set-a-b-c.png",
    );
    expect(studioDownloadFileName("", variant("../"), null, "png")).toBe("design-option.png");
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

  it("says which earlier version was open when picking", () => {
    const withRevisions = { ...b!, revisions: [{ file: "b.v1.html" }] };
    expect(withStudioPickLine("", manifest, setPath, withRevisions, 1)).toBe(
      `Studio pick for "Launch": option B, picked while viewing its earlier version v1 (${setPath}/b.v1.html). Refine only this one.`,
    );
  });

  it("asks the agent to restore a version, replacing an earlier request for that option", () => {
    const withRevisions = { ...b!, revisions: [{ file: "b.v1.html" }, { file: "b.v2.html" }] };
    const first = withStudioRestoreLine("Hi", manifest, setPath, withRevisions, 1);
    expect(first).toBe(
      `Hi\nStudio restore for "Launch": restore option B to v1 (${setPath}/b.v1.html) as the latest version.`,
    );
    expect(withStudioRestoreLine(first, manifest, setPath, withRevisions, 2)).toBe(
      `Hi\nStudio restore for "Launch": restore option B to v2 (${setPath}/b.v2.html) as the latest version.`,
    );
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
    version: null,
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

  describe("on earlier versions", () => {
    const b2 = { ...b!, revisions: [{ file: "b.v1.html" }, { file: "b.v2.html" }] };

    it("names the version in comments and pins", () => {
      const onV1 = { ...anchored, number: 1, version: 1, page: null };
      expect(studioPinLine(b2, onV1)).toBe(
        "Option B v1, pin 1 (about 30% from the left and 10% from the top of the visible area): make this bigger",
      );
      expect(withStudioComment("", manifest, setPath, b2, "Calmer", 2)).toBe(
        `Studio comment on option B v2 of "Launch" (${setPath}/b.v2.html): Calmer`,
      );
    });

    it("lists pins under their own version, oldest first, with the free comment on the viewed one", () => {
      const onV1 = { ...anchored, number: 1, version: 1, page: null };
      expect(
        withStudioFeedback("", manifest, setPath, b2, {
          comment: "Calmer",
          version: null,
          pins: [anchored, onV1],
        }),
      ).toBe(
        [
          `Studio comments on option B v1 of "Launch" (${setPath}/b.v1.html):`,
          "Option B v1, pin 1 (about 30% from the left and 10% from the top of the visible area): make this bigger",
          `Studio comments on option B of "Launch" (${setPath}/b.html):`,
          "Option B, overall: Calmer",
          `Option B, pin 2 (near "Get 'started'" (main > a.cta), about 30% from the left and 15% from the top of the page): make this bigger`,
        ].join("\n"),
      );
    });

    it("sends a viewed-version comment alone when it has no pins", () => {
      expect(
        withStudioFeedback("", manifest, setPath, b2, { comment: "Calmer", version: 1, pins: [] }),
      ).toBe(`Studio comment on option B v1 of "Launch" (${setPath}/b.v1.html): Calmer`);
    });
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
