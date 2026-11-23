import {
  PROJECT_COMPLETE_CODE_MAX_PREFIX,
  PROJECT_COMPLETE_CODE_MAX_SUFFIX,
} from "@t3tools/contracts";

export interface SuggestionContext {
  readonly prefix: string;
  readonly suffix: string;
  readonly cursor: { readonly line: number; readonly character: number };
}

/** Splits the editor's excerpt at the caret and finds the caret's document position. */
export function suggestionContext(request: {
  readonly excerptText: string;
  readonly excerptStartLine: number;
  readonly cursorOffsetInExcerpt: number;
}): SuggestionContext {
  const before = request.excerptText.slice(0, request.cursorOffsetInExcerpt);
  const lines = before.split(/\r\n|\r|\n/);
  return {
    prefix: before.slice(-PROJECT_COMPLETE_CODE_MAX_PREFIX),
    suffix: request.excerptText
      .slice(request.cursorOffsetInExcerpt)
      .slice(0, PROJECT_COMPLETE_CODE_MAX_SUFFIX),
    cursor: {
      line: request.excerptStartLine + lines.length - 1,
      character: lines.at(-1)?.length ?? 0,
    },
  };
}

/** Asks only at a natural pause: not mid-word, and not on an empty file. */
export function shouldSuggest(context: SuggestionContext): boolean {
  if (context.prefix.trim().length === 0) return false;
  return !/^[\w$]/.test(context.suffix);
}

/** The caret after inserting `text` at `cursor`. */
export function cursorAfterInsert(
  cursor: SuggestionContext["cursor"],
  text: string,
): SuggestionContext["cursor"] {
  const lines = text.split(/\r\n|\r|\n/);
  return lines.length === 1
    ? { line: cursor.line, character: cursor.character + text.length }
    : { line: cursor.line + lines.length - 1, character: lines.at(-1)!.length };
}
