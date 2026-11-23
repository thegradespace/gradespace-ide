import type { TypingDocument } from "./fileEditorTyping.logic";

const JS_KEYWORDS =
  "async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof interface let new null return static super switch this throw true try type typeof undefined var void while yield console document window".split(
    " ",
  );
const TS_EXTRA =
  "enum implements keyof namespace private protected public readonly satisfies unknown never string number boolean".split(
    " ",
  );
const PY_KEYWORDS =
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield print len range".split(
    " ",
  );
const HTML_WORDS =
  "html head body title meta link script style div span section article header footer main nav aside button input label form select option textarea img picture source video audio canvas svg table thead tbody tr th td ul ol li strong em small template slot class id href src alt type name value placeholder rel content charset width height loading target disabled required checked hidden aria-label aria-hidden role style for action method lang title srcset data-".split(
    " ",
  );
/** HTML attributes that take a value; picking one inside a tag inserts `name=""`. */
const HTML_VALUE_ATTRIBUTES: ReadonlySet<string> = new Set(
  "class id href src alt type name value placeholder rel content charset width height loading target role style for action method lang title srcset sizes media aria-label aria-hidden aria-describedby".split(
    " ",
  ),
);
const NO_VALUE_ATTRIBUTES: ReadonlySet<string> = new Set();

const CSS_WORDS =
  "display flex grid block inline none position absolute relative fixed sticky width height margin padding border background color font-size font-weight font-family line-height letter-spacing text-align justify-content align-items gap opacity transform transition overflow z-index cursor box-shadow border-radius important".split(
    " ",
  );

const JS_EXTENSIONS = new Set(["js", "jsx", "mjs", "cjs"]);
const TS_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts"]);
const HTML_EXTENSIONS = new Set(["html", "htm", "vue", "svelte", "astro", "php"]);
const CSS_EXTENSIONS = new Set(["css", "scss", "sass", "less"]);
const PLAIN_EXTENSIONS = new Set(["txt", "log", "csv", "tsv"]);

export interface WordLanguage {
  readonly enabled: boolean;
  /** Words may contain `-`, as in CSS properties and HTML attributes. */
  readonly dashWords: boolean;
  readonly keywords: readonly string[];
  readonly valueAttributes: ReadonlySet<string>;
}

export function wordLanguageForPath(path: string): WordLanguage {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  const code = (keywords: readonly string[], dashWords = false): WordLanguage => ({
    enabled: true,
    dashWords,
    keywords,
    valueAttributes: NO_VALUE_ATTRIBUTES,
  });
  if (extension === "" || PLAIN_EXTENSIONS.has(extension)) return { ...code([]), enabled: false };
  if (TS_EXTENSIONS.has(extension))
    return code(
      extension === "tsx"
        ? [...JS_KEYWORDS, ...TS_EXTRA, ...HTML_WORDS]
        : [...JS_KEYWORDS, ...TS_EXTRA],
    );
  if (JS_EXTENSIONS.has(extension))
    return code(extension === "jsx" ? [...JS_KEYWORDS, ...HTML_WORDS] : JS_KEYWORDS);
  if (extension === "py") return code(PY_KEYWORDS);
  if (HTML_EXTENSIONS.has(extension))
    return {
      ...code([...HTML_WORDS, ...CSS_WORDS, ...JS_KEYWORDS], true),
      valueAttributes: HTML_VALUE_ATTRIBUTES,
    };
  if (CSS_EXTENSIONS.has(extension)) return code(CSS_WORDS, true);
  return code([]);
}

/** The text to insert for a picked word: an HTML attribute inside a tag gets `=""`. */
export function wordInsertion(
  word: string,
  language: WordLanguage,
  context: { readonly insideTag: boolean; readonly nextChar: string | undefined },
): { readonly text: string; readonly caretOffset: number } {
  return context.insideTag && context.nextChar !== "=" && language.valueAttributes.has(word)
    ? { text: `${word}=""`, caretOffset: word.length + 2 }
    : { text: word, caretOffset: word.length };
}

const isWordChar = (char: string, dashWords: boolean) =>
  /[\w$]/.test(char) || (dashWords && char === "-");

/** The word being typed just before the caret. */
function wordBeforeCaret(
  lineText: string,
  character: number,
  language: WordLanguage,
): { readonly start: number; readonly prefix: string } {
  let start = character;
  while (start > 0 && isWordChar(lineText[start - 1]!, language.dashWords)) start -= 1;
  return { start, prefix: lineText.slice(start, character) };
}

const MAX_SCAN_LINES = 5_000;
const MIN_PREFIX = 2;
const MAX_SUGGESTIONS = 8;

/** Words from the file and the language that start with `prefix`, most used first. */
export function collectWordSuggestions(
  document: TypingDocument,
  caret: { readonly line: number; readonly character: number },
  language: WordLanguage,
): { readonly start: number; readonly prefix: string; readonly words: readonly string[] } | null {
  if (!language.enabled) return null;
  const lineText = document.getLineText(caret.line);
  if (isWordChar(lineText[caret.character] ?? "", language.dashWords)) return null;
  const { start, prefix } = wordBeforeCaret(lineText, caret.character, language);
  if (prefix.length < MIN_PREFIX || /^\d/.test(prefix)) return null;
  const pattern = language.dashWords ? /[A-Za-z_$][\w$-]*/g : /[A-Za-z_$][\w$]*/g;
  const counts = new Map<string, number>();
  const first = Math.max(0, caret.line - MAX_SCAN_LINES / 2);
  const last = Math.min(document.lineCount, first + MAX_SCAN_LINES);
  const lowerPrefix = prefix.toLowerCase();
  for (let line = first; line < last; line++) {
    const text = document.getLineText(line);
    for (const match of text.matchAll(pattern)) {
      const word = match[0];
      // The word under the caret is the one being typed.
      if (line === caret.line && match.index === start) continue;
      if (word.length <= prefix.length || !word.toLowerCase().startsWith(lowerPrefix)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  for (const word of language.keywords) {
    if (
      word.length > prefix.length &&
      word.toLowerCase().startsWith(lowerPrefix) &&
      !counts.has(word)
    )
      counts.set(word, 0);
  }
  const words = [...counts.entries()]
    .toSorted(
      ([a, countA], [b, countB]) =>
        Number(b.startsWith(prefix)) - Number(a.startsWith(prefix)) ||
        countB - countA ||
        a.length - b.length ||
        a.localeCompare(b),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map(([word]) => word);
  return words.length === 0 ? null : { start, prefix, words };
}
