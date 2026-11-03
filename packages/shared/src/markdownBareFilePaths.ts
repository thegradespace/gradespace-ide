import type { Link, Parent, PhrasingContent, Root, Text } from "mdast";

export interface BareFilePathMatch {
  readonly start: number;
  readonly end: number;
  readonly path: string;
}

// Absolute or home paths that start a word. The lookbehind keeps `https://host/a.pdf` and `a/b.pdf` out.
const BARE_PATH_CANDIDATE = /(?<=^|[\s("'[<])(?:~\/|\/(?![/\s]))[^\s]*/gu;
const TRAILING_PUNCTUATION = /[.,;:!?'"*]/u;
const CLOSING_BRACKETS = new Map([
  [")", "("],
  ["]", "["],
  [">", "<"],
]);
const POSITION_SUFFIX = /(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/u;
// Prose never writes these in a filename; shell globs, regexes, and templates do.
const NOT_A_FILE_PATH = /[*?<>|"`{}\\^$]/u;
const FILE_NAME_WITH_EXTENSION = /^[^/]*[^/.]\.[A-Za-z0-9]{1,12}$/u;

function stripTrailingPunctuation(candidate: string): string {
  let end = candidate.length;
  while (end > 0) {
    const last = candidate[end - 1]!;
    const opener = CLOSING_BRACKETS.get(last);
    if (opener !== undefined) {
      const body = candidate.slice(0, end);
      const opens = body.split(opener).length - 1;
      const closes = body.split(last).length - 1;
      // A name like `report (final).pdf` keeps its pair; `(see /a/b.pdf)` loses the stray one.
      if (closes <= opens) break;
    } else if (!TRAILING_PUNCTUATION.test(last)) {
      break;
    }
    end -= 1;
  }
  return candidate.slice(0, end);
}

function isFilePath(pathWithPosition: string): boolean {
  const path = pathWithPosition.replace(POSITION_SUFFIX, "");
  if (NOT_A_FILE_PATH.test(path)) return false;
  const segments = path.split("/");
  const directories = segments.slice(1, -1);
  // `/file.pdf` carries too little to tell a path from a route; `/dir/file.pdf` and `~/file.pdf` do.
  return (
    directories.length >= (path.startsWith("~/") ? 0 : 1) &&
    directories.every((segment) => segment !== "") &&
    FILE_NAME_WITH_EXTENSION.test(segments.at(-1) ?? "")
  );
}

/**
 * Absolute (`/…`) and home (`~/…`) file paths written as plain text. Conservative on purpose: a
 * path ends at whitespace, trailing punctuation is not part of it, and it needs a directory and a
 * file extension, so routes, globs, and URLs stay text.
 */
export function findBareFilePaths(text: string): BareFilePathMatch[] {
  const matches: BareFilePathMatch[] = [];
  for (const match of text.matchAll(BARE_PATH_CANDIDATE)) {
    const path = stripTrailingPunctuation(match[0]);
    if (isFilePath(path)) {
      matches.push({ start: match.index, end: match.index + path.length, path });
    }
  }
  return matches;
}

const FENCED_CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/u;
const INLINE_CODE_SPAN = /`[^`\n]+`/gu;

/** The bare paths in Markdown source, without those in code. Used to know the links before parsing. */
export function extractBareFilePaths(markdown: string): string[] {
  const paths: string[] = [];
  const segments = markdown.split(FENCED_CODE_SEGMENT);
  for (let index = 0; index < segments.length; index += 2) {
    const prose = (segments[index] ?? "").replace(INLINE_CODE_SPAN, " ");
    for (const { path } of findBareFilePaths(prose)) paths.push(path);
  }
  return paths;
}

// Nodes whose text is not prose, or already part of a link.
const SKIPPED_PARENTS = new Set(["link", "linkReference", "definition"]);

function linkBarePaths(text: Text): PhrasingContent[] | null {
  const matches = findBareFilePaths(text.value);
  if (matches.length === 0) return null;
  const nodes: PhrasingContent[] = [];
  let cursor = 0;
  for (const { start, end, path } of matches) {
    if (start > cursor) nodes.push({ type: "text", value: text.value.slice(cursor, start) });
    const link: Link = {
      type: "link",
      url: path,
      title: null,
      children: [{ type: "text", value: path }],
      data: { hProperties: { dataBareFilePath: "" } },
    };
    nodes.push(link);
    cursor = end;
  }
  if (cursor < text.value.length) nodes.push({ type: "text", value: text.value.slice(cursor) });
  return nodes;
}

function visit(parent: Parent) {
  if (SKIPPED_PARENTS.has(parent.type)) return;
  const children = parent.children as PhrasingContent[];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (child.type === "text") {
      const replacement = linkBarePaths(child);
      if (replacement) {
        children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
      }
    } else if ("children" in child) {
      visit(child as Parent);
    }
  }
}

/** Turns bare absolute file paths in prose into links, which chat renders as file chips. */
export function remarkLinkBareFilePaths() {
  return (tree: Root) => visit(tree);
}
