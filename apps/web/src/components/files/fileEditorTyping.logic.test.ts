import { describe, expect, it } from "vite-plus/test";

import {
  detectIndentUnit,
  planTyping,
  type TypingInput,
  type TypingPlan,
  type TypingRange,
  typingLanguageForPath,
} from "./fileEditorTyping.logic";

/** `|` marks the caret. Returns the text after the plan runs, with `|` at the new caret. */
function type(path: string, source: string, input: TypingInput | string): string | null {
  const lines = source.split("\n");
  const caretLine = lines.findIndex((line) => line.includes("|"));
  const character = lines[caretLine]!.indexOf("|");
  lines[caretLine] = lines[caretLine]!.replace("|", "");
  const document = { lineCount: lines.length, getLineText: (line: number) => lines[line] ?? "" };
  const selection: TypingRange = {
    start: { line: caretLine, character },
    end: { line: caretLine, character },
  };
  const plan = planTyping(
    document,
    [selection],
    typeof input === "string" ? { kind: "text", text: input } : input,
    typingLanguageForPath(path),
  );
  return plan === null ? null : apply(lines, plan);
}

function apply(lines: string[], plan: TypingPlan): string {
  let text = lines.join("\n");
  const offset = (line: number, character: number, of: string) =>
    of
      .split("\n")
      .slice(0, line)
      .reduce((sum, l) => sum + l.length + 1, 0) + character;
  const edits = [...plan.edits].sort(
    (a, b) =>
      offset(b.range.start.line, b.range.start.character, text) -
      offset(a.range.start.line, a.range.start.character, text),
  );
  for (const edit of edits) {
    const start = offset(edit.range.start.line, edit.range.start.character, text);
    const end = offset(edit.range.end.line, edit.range.end.character, text);
    text = text.slice(0, start) + edit.newText + text.slice(end);
  }
  const caret = plan.selections[0]!.start;
  const at = offset(caret.line, caret.character, text);
  return `${text.slice(0, at)}|${text.slice(at)}`;
}

const enter = { kind: "enter" } as const;
const backspace = { kind: "backspace" } as const;

describe("closing tags", () => {
  it.each([
    ["index.html", "<div|", "<div>|</div>"],
    ["index.html", '<a href="/x" class="y"|', '<a href="/x" class="y">|</a>'],
    ["App.tsx", "return <Card title={t}|", "return <Card title={t}>|</Card>"],
    ["App.vue", "<template|", "<template>|</template>"],
    ["feed.xml", "<link|", "<link>|</link>"],
  ])("%s: closes %s", (path, source, expected) => {
    expect(type(path, source, ">")).toBe(expected);
  });

  it.each([
    ["index.html", "<br|", "void element"],
    ["index.html", "<img src=x /|", "self-closing"],
    ["index.html", "<div|</div>", "already closed"],
    ["index.ts", "<div|", "not markup"],
    ["App.tsx", "const x: Array<string|", "type argument"],
    ["App.tsx", "const f = <T|", "generic arrow"],
    ["App.tsx", "if (a<b|", "comparison"],
    ["notes.txt", "<div|", "plain text"],
  ])("%s: leaves %s (%s)", (path, source) => {
    expect(type(path, source, ">")).toBeNull();
  });

  it("adds quotes after an attribute name", () => {
    expect(type("index.html", "<a href|", "=")).toBe('<a href="|"');
    expect(type("index.html", "<div data-id|>", "=")).toBe('<div data-id="|">');
    expect(type("feed.xml", "<link rel|", "=")).toBe('<link rel="|"');
    expect(type("index.html", "a href|", "=")).toBeNull();
    expect(type("index.html", '<a title="x href|', "=")).toBeNull();
    expect(type("App.tsx", "<a href|", "=")).toBeNull();
  });

  it("closes a tag whose attributes span lines", () => {
    expect(type("index.html", '<section\n  id="hero"|', ">")).toBe(
      '<section\n  id="hero">|</section>',
    );
  });

  it("finishes `</` with the innermost open tag", () => {
    expect(type("index.html", "<ul>\n  <li>One<|", "/")).toBe("<ul>\n  <li>One</li>|");
    expect(type("index.html", "<ul>\n  <li>One</li>\n<|", "/")).toBe(
      "<ul>\n  <li>One</li>\n</ul>|",
    );
    expect(type("index.html", "<p>Hi<br><!-- <b> --><|", "/")).toBe("<p>Hi<br><!-- <b> --></p>|");
    expect(type("index.html", "<p></p><|", "/")).toBeNull();
  });

  it("steps `</` back to the open tag's indent on its own line", () => {
    expect(type("index.html", "<div>\n  <p>x</p>\n  <|", "/")).toBe("<div>\n  <p>x</p>\n</div>|");
  });
});

describe("pairs", () => {
  it.each([
    ["a.ts", "call|", "(", "call(|)"],
    ["a.ts", "const a = |", "[", "const a = [|]"],
    ["a.ts", "if (x) |", "{", "if (x) {|}"],
    ["a.ts", "f(|)", '"', 'f("|")'],
    ["a.ts", "const s = |", "`", "const s = `|`"],
    ["a.py", "x = |", "'", "x = '|'"],
    ["a.md", "See |", "[", "See [|]"],
  ])("%s: %s + %s", (path, source, text, expected) => {
    expect(type(path, source, text)).toBe(expected);
  });

  it.each([
    ["a.ts", "call|x", "(", "before a word"],
    ["a.ts", "don|", "'", "apostrophe"],
    ["a.md", "it|", "'", "prose"],
    ["a.md", "say |", '"', "prose quotes"],
    ["a.py", "x = |", "`", "backtick outside JS"],
    ["notes.txt", "a |", "(", "plain text"],
  ])("%s: no pair for %s + %s (%s)", (path, source, text) => {
    expect(type(path, source, text)).toBeNull();
  });

  it("types over the closing character", () => {
    expect(type("a.ts", "f(x|)", ")")).toBe("f(x)|");
    expect(type("a.ts", 'f("x|")', '"')).toBe('f("x"|)');
  });

  it("deletes an empty pair together", () => {
    expect(type("a.ts", "f(|)", backspace)).toBe("f|");
    expect(type("a.ts", "s = '|'", backspace)).toBe("s = |");
    expect(type("a.ts", "f(x|)", backspace)).toBeNull();
  });

  it("steps a closing bracket back one indent on an empty line", () => {
    expect(type("a.ts", "if (x) {\n  a();\n  |", "}")).toBe("if (x) {\n  a();\n}|");
  });
});

describe("Enter", () => {
  it.each([
    ["a.ts", "  const a = 1;|", "  const a = 1;\n  |"],
    ["a.ts", "function f() {|", "function f() {\n  |"],
    ["a.ts", "function f() {|}", "function f() {\n  |\n}"],
    ["a.ts", "  call(|)", "  call(\n    |\n  )"],
    ["a.ts", "const a = [|]", "const a = [\n  |\n]"],
    ["index.html", "<div>|</div>", "<div>\n  |\n</div>"],
    ["index.html", '  <ul class="x">|', '  <ul class="x">\n    |'],
    ["index.html", "<br>|", "<br>\n|"],
    ["index.html", "<p>a</p>|", "<p>a</p>\n|"],
    ["a.py", "def f():|", "def f():\n  |"],
    ["a.ts", "  a();   |b()", "  a();\n  |b()"],
    ["a.ts", "    |", "\n    |"],
  ])("%s: %s", (path, source, expected) => {
    expect(type(path, source, enter)).toBe(expected);
  });

  it("uses the file's own indent", () => {
    expect(type("a.ts", "if (x) {\n\ta();\n}\nif (y) {|}", enter)).toBe(
      "if (x) {\n\ta();\n}\nif (y) {\n\t|\n}",
    );
    expect(type("a.ts", "if (x) {\n    a();\n}\nif (y) {|", enter)).toBe(
      "if (x) {\n    a();\n}\nif (y) {\n    |",
    );
  });
});

describe("detectIndentUnit", () => {
  const doc = (text: string) => {
    const lines = text.split("\n");
    return { lineCount: lines.length, getLineText: (line: number) => lines[line] ?? "" };
  };
  it("defaults to two spaces and ignores single alignment spaces", () => {
    expect(detectIndentUnit(doc("a\nb"))).toBe("  ");
    expect(detectIndentUnit(doc("/**\n * x\n */\nf() {\n    y\n}"))).toBe("    ");
  });
});

describe("several carets", () => {
  it("indents each line on Enter", () => {
    const lines = ["a {", "b {"];
    const document = { lineCount: 2, getLineText: (line: number) => lines[line] ?? "" };
    const plan = planTyping(
      document,
      [0, 1].map((line) => ({ start: { line, character: 3 }, end: { line, character: 3 } })),
      enter,
      typingLanguageForPath("a.ts"),
    );
    expect(plan?.selections.map((s) => s.start)).toEqual([
      { line: 1, character: 2 },
      { line: 3, character: 2 },
    ]);
  });
});
