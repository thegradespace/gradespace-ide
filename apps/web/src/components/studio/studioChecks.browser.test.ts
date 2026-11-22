import { describe, expect, it } from "vite-plus/test";

import { contrastRatio, parseCssColor, resolveLocalReference } from "./studioChecks";
import { checkStudioHtml } from "./studioChecksFrame";

const baseDir = ".gradespace/studio/2026-11-22-test";

function filesOf(contents: Record<string, string>) {
  return {
    readText: async (path: string) => contents[path] ?? null,
    exists: async (path: string) => path in contents,
  };
}

const page = (body: string, head = "", lang = ' lang="en"') =>
  `<!doctype html><html${lang}><head><title>T</title>${head}</head><body>${body}</body></html>`;

describe("runStudioChecks", () => {
  it("passes a clean page", async () => {
    const issues = await checkStudioHtml(
      page(
        `<header><h1>Acme</h1><a href="about.html">About</a></header>
         <main><h2>Plans</h2><img src="img/hero.png" alt="A desk">
         <label>Email <input type="email"></label><button>Join</button>
         <p style="color:#fff;background:#111">Dark band</p>
         <p style="background-image:linear-gradient(red,blue);color:#eee">Over a gradient</p></main>`,
      ),
      baseDir,
      filesOf({ [`${baseDir}/about.html`]: "", [`${baseDir}/img/hero.png`]: "" }),
    );
    expect(issues).toEqual([]);
  });

  it("finds contrast, accessibility and link problems", async () => {
    const issues = await checkStudioHtml(
      page(
        `<h1>Title</h1><h3 class="skip">Skipped</h3>
         <p class="faint">Faint copy</p>
         <p style="font-size:30px;color:#888">Big grey</p>
         <img src="img/missing.png">
         <button><svg></svg></button><a href="#">Read more</a><a href="next.html"></a>
         <input id="q" placeholder="Search">
         <span hidden style="color:#eee">Hidden faint</span>`,
        `<link rel="stylesheet" href="styles.css">`,
        "",
      ),
      baseDir,
      filesOf({ [`${baseDir}/styles.css`]: ".faint { color: #aaa; }" }),
    );
    expect(issues.map((issue) => [issue.kind, issue.message, issue.selector])).toEqual([
      [
        "contrast",
        'Low contrast: "Faint copy" is 2.3:1, needs 4.5:1',
        "body > p.faint:nth-of-type(1)",
      ],
      ["accessibility", "The page has no lang attribute", null],
      ["accessibility", "Image has no alt text: missing.png", "body > img"],
      ["accessibility", "Button has no accessible name", "body > button"],
      ["accessibility", "Link has no accessible name", "body > a:nth-of-type(2)"],
      ["accessibility", "Form field has no label", "input#q"],
      ["accessibility", 'Heading skips a level, h1 to h3: "Skipped"', "body > h3.skip"],
      ["links", 'Link goes nowhere (href="#"): "Read more"', "body > a:nth-of-type(1)"],
      ["links", "Missing file: next.html", "body > a:nth-of-type(2)"],
      ["links", "Missing file: img/missing.png", "body > img"],
    ]);
  });
});

describe("helpers", () => {
  it("reads computed colours and measures contrast", () => {
    expect(parseCssColor("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor("rgb(255 255 255 / 50%)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseCssColor("#0f08")).toEqual({ r: 0, g: 255, b: 0, a: 136 / 255 });
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(contrastRatio(parseCssColor("#000")!, parseCssColor("#fff")!)).toBeCloseTo(21);
  });

  it("resolves only links to local files inside the project", () => {
    expect(resolveLocalReference(baseDir, "./img/a%20b.png?v=2#x")).toBe(`${baseDir}/img/a b.png`);
    expect(resolveLocalReference(baseDir, "../shared/logo.svg")).toBe(
      ".gradespace/studio/shared/logo.svg",
    );
    for (const outside of [
      "https://example.com/a.png",
      "//cdn.example.com/a.js",
      "mailto:a@b.c",
      "data:image/png;base64,AA",
      "/root.png",
      "#top",
      "",
      "../../../../x.png",
    ]) {
      expect(resolveLocalReference(baseDir, outside)).toBeNull();
    }
  });
});
