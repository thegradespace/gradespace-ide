import { describe, expect, it } from "vite-plus/test";

import { cleanCodeCompletion } from "./CodeCompletion.ts";

describe("cleanCodeCompletion", () => {
  it.each([
    ["plain insertion", "log(x);", "  console.", "log(x);"],
    ["strips a fence", "```ts\nlog(x);\n```", "  console.", "log(x);"],
    ["drops an echoed current line", "  console.log(x);", "a\n  console.", "log(x);"],
    ["keeps leading spaces after a blank line", "  return 1;", "{\n", "  return 1;"],
    ["trims trailing whitespace", "x;\n\n", "", "x;"],
  ])("%s", (_name, raw, prefix, expected) => {
    expect(cleanCodeCompletion(raw, prefix)).toBe(expected);
  });
});
