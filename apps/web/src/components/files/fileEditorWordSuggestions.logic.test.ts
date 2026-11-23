import { describe, expect, it } from "vite-plus/test";

import { collectWordSuggestions, wordLanguageForPath } from "./fileEditorWordSuggestions.logic";

/** `|` marks the caret. */
function suggest(path: string, source: string) {
  const lines = source.split("\n");
  const line = lines.findIndex((text) => text.includes("|"));
  const character = lines[line]!.indexOf("|");
  lines[line] = lines[line]!.replace("|", "");
  const document = { lineCount: lines.length, getLineText: (index: number) => lines[index] ?? "" };
  return (
    collectWordSuggestions(document, { line, character }, wordLanguageForPath(path))?.words ?? null
  );
}

describe("collectWordSuggestions", () => {
  it("offers words from the file, most used first, without the word being typed", () => {
    expect(suggest("a.ts", "const userName = 1;\nuserId; userId;\nus|")).toEqual([
      "userId",
      "userName",
    ]);
  });

  it("adds language keywords and HTML words", () => {
    expect(suggest("a.ts", "ret|")).toEqual(["return"]);
    expect(suggest("a.py", "de|")).toEqual(["def", "del"]);
    expect(suggest("index.html", "<but|")).toEqual(["button"]);
    expect(suggest("index.html", "<div aria-l|")).toEqual(["aria-label"]);
  });

  it("stays quiet when it would get in the way", () => {
    expect(suggest("a.ts", "r|")).toBeNull();
    expect(suggest("a.ts", "re|turn")).toBeNull();
    expect(suggest("notes.txt", "hello\nhe|")).toBeNull();
    expect(suggest("a.ts", "12|")).toBeNull();
  });
});
