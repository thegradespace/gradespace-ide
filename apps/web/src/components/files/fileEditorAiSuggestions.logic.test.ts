import { describe, expect, it } from "vite-plus/test";

import {
  cursorAfterInsert,
  shouldSuggest,
  suggestionContext,
} from "./fileEditorAiSuggestions.logic";

describe("AI suggestion context", () => {
  it("finds the caret's document position from the excerpt", () => {
    const context = suggestionContext({
      excerptText: "a\nfunction f() {\n  ret\n}",
      excerptStartLine: 10,
      cursorOffsetInExcerpt: "a\nfunction f() {\n  ret".length,
    });
    expect(context.cursor).toEqual({ line: 12, character: 5 });
    expect(context.suffix).toBe("\n}");
    expect(shouldSuggest(context)).toBe(true);
  });

  it("skips mid-word and empty files", () => {
    const at = (text: string, offset: number) =>
      shouldSuggest(
        suggestionContext({
          excerptText: text,
          excerptStartLine: 0,
          cursorOffsetInExcerpt: offset,
        }),
      );
    expect(at("return", 3)).toBe(false);
    expect(at("   ", 3)).toBe(false);
  });

  it("moves the caret past single and multi-line insertions", () => {
    expect(cursorAfterInsert({ line: 2, character: 4 }, "urn x;")).toEqual({
      line: 2,
      character: 10,
    });
    expect(cursorAfterInsert({ line: 2, character: 4 }, "{\n  y\n}")).toEqual({
      line: 4,
      character: 1,
    });
  });
});
