import { expect, it } from "vite-plus/test";

import { extractBareFilePaths, findBareFilePaths } from "./markdownBareFilePaths.ts";

const paths = (text: string) => findBareFilePaths(text).map((match) => match.path);

it.each([
  [
    "Receipt: /Users/me/Invoices/2026/FEMAJ/GS-RCT-2026-0005.pdf",
    ["/Users/me/Invoices/2026/FEMAJ/GS-RCT-2026-0005.pdf"],
  ],
  [
    "Script: /Users/me/letters/generate_femaj_ack_2026_11_03.py",
    ["/Users/me/letters/generate_femaj_ack_2026_11_03.py"],
  ],
  ["Saved to ~/Downloads/report.md.", ["~/Downloads/report.md"]],
  ["See ~/notes.txt, then /tmp/out.png; done", ["~/notes.txt", "/tmp/out.png"]],
  ["(see /Users/me/a.pdf)", ["/Users/me/a.pdf"]],
  ['"/Users/me/a.pdf"', ["/Users/me/a.pdf"]],
  ["/Users/me/report (final).pdf is not a path with spaces", []],
  ["/Users/me/report_(final).pdf", ["/Users/me/report_(final).pdf"]],
  ["at /Users/me/app.ts:42:7!", ["/Users/me/app.ts:42:7"]],
  ["at /Users/me/app.ts#L10-L20", ["/Users/me/app.ts#L10-L20"]],
  ["/Users/me/.config/tool.json", ["/Users/me/.config/tool.json"]],
])("finds file paths in %j", (text, expected) => {
  expect(paths(text)).toEqual(expected);
});

it.each([
  "https://example.com/a/b.pdf",
  "file:///Users/me/a.pdf",
  "relative/dir/a.pdf",
  "and/or a.pdf",
  "/Users/me/folder",
  "/etc/hosts",
  "/a.pdf",
  "//host/share/a.pdf",
  "/src/**/*.ts",
  "/api/{id}/export.json",
  "/Users/me/.env",
  "v1.2/3",
  "~user/a.pdf",
  "C:/Users/me/a.pdf",
])("leaves %j as text", (text) => {
  expect(paths(text)).toEqual([]);
});

it("reports offsets that exclude trailing punctuation", () => {
  const text = "Open /Users/me/a.pdf.";
  const [match] = findBareFilePaths(text);
  expect(text.slice(match!.start, match!.end)).toBe("/Users/me/a.pdf");
});

it("extracts paths from prose only, not from code", () => {
  const markdown = [
    "Prose /Users/me/a.pdf here",
    "`/Users/me/inline.pdf`",
    "```sh",
    "open /Users/me/fenced.pdf",
    "```",
    "~~~",
    "/Users/me/tilde-fenced.pdf",
    "~~~",
    "- /Users/me/b.md",
  ].join("\n");
  expect(extractBareFilePaths(markdown)).toEqual(["/Users/me/a.pdf", "/Users/me/b.md"]);
});
