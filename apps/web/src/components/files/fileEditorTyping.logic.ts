/**
 * Editing help for the file editor: closing tags, bracket and quote pairs, and
 * indentation on Enter. Pure functions over the document's lines, so they can be
 * tested without the editor. Each returns `null` when the editor's own handling
 * should run instead.
 */

export interface TypingPosition {
  readonly line: number;
  readonly character: number;
}

export interface TypingRange {
  readonly start: TypingPosition;
  readonly end: TypingPosition;
}

export interface TypingEdit {
  readonly range: TypingRange;
  readonly newText: string;
}

export interface TypingPlan {
  readonly edits: TypingEdit[];
  readonly selections: TypingRange[];
}

export interface TypingDocument {
  readonly lineCount: number;
  getLineText(line: number): string;
}

export type TypingInput =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "enter" }
  | { readonly kind: "backspace" };

export interface TypingLanguage {
  /** Close `<tag>` with `</tag>` and finish `</` with the open tag's name. */
  readonly closeTags: boolean;
  /** HTML elements such as `<br>` never get a closing tag. */
  readonly voidElements: boolean;
  /** `<T>` reads as a TypeScript type, not a tag. */
  readonly typeScriptGenerics: boolean;
  readonly pairBrackets: boolean;
  /** Quote characters to pair. Empty for prose, where `'` is an apostrophe. */
  readonly pairQuotes: string;
  /** A line ending in `:` opens a block (Python, YAML). */
  readonly colonIndents: boolean;
  /** `=` after an attribute name in a tag adds `""` (HTML and XML, not JSX). */
  readonly quoteAttributes: boolean;
}

const PLAIN: TypingLanguage = {
  closeTags: false,
  voidElements: false,
  typeScriptGenerics: false,
  pairBrackets: false,
  pairQuotes: "",
  colonIndents: false,
  quoteAttributes: false,
};
const CODE: TypingLanguage = { ...PLAIN, pairBrackets: true, pairQuotes: `"'` };
const SCRIPT: TypingLanguage = { ...CODE, pairQuotes: `"'\`` };
const HTML: TypingLanguage = {
  ...CODE,
  closeTags: true,
  voidElements: true,
  quoteAttributes: true,
};
const XML: TypingLanguage = { ...CODE, closeTags: true, quoteAttributes: true };
const JSX: TypingLanguage = { ...SCRIPT, closeTags: true, voidElements: true };
const TSX: TypingLanguage = { ...JSX, typeScriptGenerics: true };
const COLON: TypingLanguage = { ...CODE, colonIndents: true };
const MARKDOWN: TypingLanguage = { ...PLAIN, pairBrackets: true };
const MDX: TypingLanguage = { ...MARKDOWN, closeTags: true, voidElements: true };

const LANGUAGES_BY_EXTENSION: Record<string, TypingLanguage> = {
  html: HTML,
  htm: HTML,
  xhtml: HTML,
  php: HTML,
  vue: HTML,
  svelte: HTML,
  astro: HTML,
  erb: HTML,
  ejs: HTML,
  hbs: HTML,
  handlebars: HTML,
  njk: HTML,
  liquid: HTML,
  xml: XML,
  svg: XML,
  plist: XML,
  xaml: XML,
  csproj: XML,
  jsx: JSX,
  tsx: TSX,
  js: SCRIPT,
  mjs: SCRIPT,
  cjs: SCRIPT,
  ts: SCRIPT,
  mts: SCRIPT,
  cts: SCRIPT,
  py: COLON,
  pyi: COLON,
  yaml: COLON,
  yml: COLON,
  md: MARKDOWN,
  markdown: MARKDOWN,
  mdx: MDX,
  txt: PLAIN,
  text: PLAIN,
  log: PLAIN,
  csv: PLAIN,
  tsv: PLAIN,
};

export function typingLanguageForPath(path: string): TypingLanguage {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name.toLowerCase() === "dockerfile" ? CODE : PLAIN;
  return LANGUAGES_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? CODE;
}

const OPEN_TO_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
/** Text before the caret that the tag scan looks at. Keeps typing cheap in long files. */
const TAG_SCAN_LINES = 400;
const WORD_CHAR = /[\p{L}\p{N}_$]/u;

/** Spaces or a tab, matching what the file already uses. */
export function detectIndentUnit(document: TypingDocument): string {
  const counts = new Map<number, number>();
  const limit = Math.min(document.lineCount, 500);
  for (let line = 0; line < limit; line++) {
    const text = document.getLineText(line);
    if (text.startsWith("\t")) return "\t";
    const spaces = /^ +(?=\S)/.exec(text)?.[0].length ?? 0;
    if (spaces > 0) counts.set(spaces, (counts.get(spaces) ?? 0) + 1);
  }
  if (counts.size === 0) return "  ";
  // The smallest indent that appears often enough to be a real step, not an alignment space.
  const smallest = Math.min(...[...counts.keys()].filter((spaces) => spaces >= 2));
  return Number.isFinite(smallest) ? " ".repeat(Math.min(smallest, 8)) : "  ";
}

function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

function caret(line: number, character: number): TypingRange {
  return { start: { line, character }, end: { line, character } };
}

function isCollapsed(range: TypingRange): boolean {
  return range.start.line === range.end.line && range.start.character === range.end.character;
}

/** The open tag the caret sits right after, or null. `before` is the text up to the caret. */
function openTagBefore(before: string, language: TypingLanguage): string | null {
  const match = /<([A-Za-z][\w:.-]*)((?:\s[^<>]*)?)$/.exec(before);
  if (!match) return null;
  const [, name, attributes] = match;
  if (name === undefined || attributes?.endsWith("/")) return null;
  const charBefore = before[match.index - 1];
  // `Array<string` is a type argument; `a <b` is a comparison.
  if (charBefore !== undefined && (WORD_CHAR.test(charBefore) || charBefore === ")")) return null;
  if (language.typeScriptGenerics && /^[A-Z]$/.test(name) && !attributes) return null;
  if (language.voidElements && VOID_ELEMENTS.has(name.toLowerCase())) return null;
  return name;
}

/** Whether `before` ends inside an open tag's attributes, outside any quoted value. */
function endsInsideOpenTag(before: string): boolean {
  const match = /<[A-Za-z][\w:.-]*(\s[^<>]*)$/.exec(before);
  if (!match) return false;
  const attributes = match[1] ?? "";
  const count = (quote: string) => attributes.split(quote).length - 1;
  return count('"') % 2 === 0 && count("'") % 2 === 0;
}

/** Whether the caret sits among a tag's attributes, so an attribute name typed here takes a value. */
export function caretInsideOpenTag(document: TypingDocument, position: TypingPosition): boolean {
  return endsInsideOpenTag(textBeforeCaret(document, position));
}

/** The innermost tag still open at the end of `text`. */
function innermostOpenTag(text: string, language: TypingLanguage): string | null {
  const stack: string[] = [];
  const tag = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?(\/?)>/g;
  for (const match of text.matchAll(tag)) {
    const [, closing, name, selfClosing] = match;
    if (name === undefined || selfClosing === "/") continue;
    if (language.voidElements && VOID_ELEMENTS.has(name.toLowerCase())) continue;
    if (closing === "/") {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.length = index;
    } else {
      stack.push(name);
    }
  }
  return stack.at(-1) ?? null;
}

function textBeforeCaret(document: TypingDocument, position: TypingPosition): string {
  const first = Math.max(0, position.line - TAG_SCAN_LINES);
  const lines: string[] = [];
  for (let line = first; line < position.line; line++) lines.push(document.getLineText(line));
  lines.push(document.getLineText(position.line).slice(0, position.character));
  return lines.join("\n");
}

function planCaretText(
  document: TypingDocument,
  position: TypingPosition,
  text: string,
  language: TypingLanguage,
  indentUnit: string,
): TypingPlan | null {
  const lineText = document.getLineText(position.line);
  const before = lineText.slice(0, position.character);
  const next = lineText[position.character];
  const prev = before.at(-1);
  const { line, character } = position;
  const insert = (newText: string, caretOffset: number): TypingPlan => ({
    edits: [{ range: caret(line, character), newText }],
    selections: [caret(line, character + caretOffset)],
  });

  // Type over a closing bracket or quote that is already there.
  const quote = language.pairQuotes.includes(text);
  if ((language.pairBrackets && CLOSERS.has(text)) || quote) {
    if (next === text) return { edits: [], selections: [caret(line, character + 1)] };
  }

  // A closing bracket typed on an empty line steps back one indent.
  if (language.pairBrackets && CLOSERS.has(text) && before.length > 0 && before.trim() === "") {
    const indent = before.endsWith(indentUnit)
      ? before.slice(0, -indentUnit.length)
      : before.slice(0, -1);
    return {
      edits: [{ range: { start: { line, character: 0 }, end: position }, newText: indent + text }],
      selections: [caret(line, indent.length + 1)],
    };
  }

  const nextAllowsPair = next === undefined || /[\s)\]}>,;:]/.test(next);

  if (language.pairBrackets && text in OPEN_TO_CLOSE && nextAllowsPair) {
    return insert(text + OPEN_TO_CLOSE[text], 1);
  }

  if (quote && nextAllowsPair) {
    // `don't`, `"abc"` and `x'` are not the start of a string.
    if (prev !== undefined && (WORD_CHAR.test(prev) || prev === text || prev === "\\")) return null;
    return insert(text + text, 1);
  }

  if (
    language.quoteAttributes &&
    text === "=" &&
    prev !== undefined &&
    /[\w-]/.test(prev) &&
    next !== '"' &&
    next !== "'" &&
    endsInsideOpenTag(textBeforeCaret(document, position))
  ) {
    return insert('=""', 2);
  }

  if (language.closeTags && text === ">") {
    const name = openTagBefore(textBeforeCaret(document, position), language);
    if (name === null) return null;
    const closing = `</${name}>`;
    if (lineText.slice(character).startsWith(closing)) return null;
    return insert(`>${closing}`, 1);
  }

  if (language.closeTags && text === "/" && prev === "<") {
    const scanned = textBeforeCaret(document, position);
    const name = innermostOpenTag(scanned.slice(0, -1), language);
    if (name === null) return null;
    const rest = lineText.slice(character);
    const closeBracket = rest.startsWith(">") ? "" : ">";
    // An empty line holding only `<` steps back to the open tag's indent.
    const onOwnLine = before.slice(0, -1).trim() === "" && before.length > 1;
    if (onOwnLine) {
      const current = before.slice(0, -1);
      const indent = current.endsWith(indentUnit) ? current.slice(0, -indentUnit.length) : current;
      const newText = `${indent}</${name}${closeBracket}`;
      return {
        edits: [{ range: { start: { line, character: 0 }, end: position }, newText }],
        selections: [caret(line, newText.length + (closeBracket ? 0 : 1))],
      };
    }
    const newText = `/${name}${closeBracket}`;
    return insert(newText, newText.length + (closeBracket ? 0 : 1));
  }

  return null;
}

function opensBlock(
  before: string,
  language: TypingLanguage,
  document: TypingDocument,
  position: TypingPosition,
): boolean {
  const trimmed = before.trimEnd();
  const last = trimmed.at(-1);
  if (last === undefined) return false;
  if (language.pairBrackets && last in OPEN_TO_CLOSE) return true;
  if (language.colonIndents && last === ":" && !trimmed.trimStart().startsWith("#")) return true;
  if (language.closeTags && last === ">") {
    const scanned = textBeforeCaret(document, position).trimEnd();
    const lastTag = /<([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?(\/?)>$/.exec(scanned);
    if (!lastTag || lastTag[2] === "/") return false;
    const name = lastTag[1] ?? "";
    return !(language.voidElements && VOID_ELEMENTS.has(name.toLowerCase()));
  }
  return false;
}

function planEnter(
  document: TypingDocument,
  range: TypingRange,
  language: TypingLanguage,
  indentUnit: string,
): { edit: TypingEdit; selection: TypingRange } {
  const { start, end } = range;
  const startLine = document.getLineText(start.line);
  const endLine = document.getLineText(end.line);
  const before = startLine.slice(0, start.character);
  const afterFull = endLine.slice(end.character);
  const after = afterFull.trimStart();
  // Whitespace right after the caret is dropped so the next line starts at its indent.
  const replaceEnd = {
    line: end.line,
    character: end.character + (afterFull.length - after.length),
  };
  // On a blank line the caret's own column is the indent, not the line's (empty) text.
  const indent = before.trim() === "" ? before : leadingWhitespace(startLine);
  const opens = opensBlock(before, language, document, start);
  const first = after[0];
  const closesRight =
    opens &&
    ((first !== undefined && CLOSERS.has(first)) || (language.closeTags && after.startsWith("</")));
  // Trailing spaces left behind on the line being split are removed.
  const keptBefore = before.trimEnd().length === 0 ? "" : before.trimEnd();
  const editStart = { line: start.line, character: keptBefore.length };
  if (closesRight) {
    const inner = indent + indentUnit;
    return {
      edit: { range: { start: editStart, end: replaceEnd }, newText: `\n${inner}\n${indent}` },
      selection: caret(start.line + 1, inner.length),
    };
  }
  const nextIndent = opens ? indent + indentUnit : indent;
  return {
    edit: { range: { start: editStart, end: replaceEnd }, newText: `\n${nextIndent}` },
    selection: caret(start.line + 1, nextIndent.length),
  };
}

function planBackspace(
  document: TypingDocument,
  position: TypingPosition,
  language: TypingLanguage,
): TypingPlan | null {
  const lineText = document.getLineText(position.line);
  const prev = lineText[position.character - 1];
  const next = lineText[position.character];
  if (prev === undefined || next === undefined) return null;
  const pairs =
    (language.pairBrackets && OPEN_TO_CLOSE[prev] === next) ||
    (language.pairQuotes.includes(prev) && prev === next);
  if (!pairs) return null;
  const { line, character } = position;
  return {
    edits: [
      {
        range: {
          start: { line, character: character - 1 },
          end: { line, character: character + 1 },
        },
        newText: "",
      },
    ],
    selections: [caret(line, character - 1)],
  };
}

/**
 * Plans the edit for one keystroke over every selection. Returns null, leaving the
 * editor to handle it, unless every selection gets the same kind of help.
 */
export function planTyping(
  document: TypingDocument,
  selections: readonly TypingRange[],
  input: TypingInput,
  language: TypingLanguage,
): TypingPlan | null {
  if (selections.length === 0) return null;
  const indentUnit = detectIndentUnit(document);
  const plans: TypingPlan[] = [];
  for (const selection of selections) {
    let plan: TypingPlan | null = null;
    if (input.kind === "enter") {
      const { edit, selection: next } = planEnter(document, selection, language, indentUnit);
      plan = { edits: [edit], selections: [next] };
    } else if (!isCollapsed(selection)) {
      return null;
    } else if (input.kind === "backspace") {
      plan = planBackspace(document, selection.start, language);
    } else if (input.text.length === 1) {
      plan = planCaretText(document, selection.start, input.text, language, indentUnit);
    }
    if (plan === null) return null;
    plans.push(plan);
  }
  if (plans.length === 1) return plans[0] ?? null;
  return mergePlans(plans);
}

/** Combines per-caret plans, shifting carets for the lines and characters earlier edits add. */
function mergePlans(plans: TypingPlan[]): TypingPlan | null {
  const edits = plans.flatMap((plan) => plan.edits);
  // Two edits on the same line would shift each other's columns; let the editor handle that.
  const editLines = edits.map((edit) => edit.range.start.line);
  if (new Set(editLines).size !== editLines.length) return null;
  const order = plans
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => planLine(a.plan) - planLine(b.plan));
  let lineShift = 0;
  const selections: TypingRange[] = [];
  for (const { plan } of order) {
    for (const selection of plan.selections) {
      selections.push({
        start: { line: selection.start.line + lineShift, character: selection.start.character },
        end: { line: selection.end.line + lineShift, character: selection.end.character },
      });
    }
    for (const edit of plan.edits) {
      const added = edit.newText.split("\n").length - 1;
      const removed = edit.range.end.line - edit.range.start.line;
      lineShift += added - removed;
    }
  }
  return { edits, selections };
}

function planLine(plan: TypingPlan): number {
  return plan.edits[0]?.range.start.line ?? plan.selections[0]?.start.line ?? 0;
}
