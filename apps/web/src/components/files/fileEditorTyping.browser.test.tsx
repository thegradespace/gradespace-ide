import { DEFAULT_THEMES, preloadHighlighter } from "@pierre/diffs";
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import { EditProvider, File } from "@pierre/diffs/react";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";

import { installFileEditorTyping } from "./fileEditorTyping";

describe("installFileEditorTyping", () => {
  it("closes tags and indents through the editor's own input path, with undo", async () => {
    let editor: Editor<"file", never, never> | undefined;
    const createEditor: EditorFactory<never, never> = (...args) =>
      (editor = new Editor(...args) as never);
    await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["html"] });
    await using screen = await render(
      <div data-testid="file-surface">
        <EditProvider createEditor={createEditor}>
          <File file={{ name: "index.html", contents: "<div\n" }} edit />
        </EditProvider>
      </div>,
    );
    using _typing = {
      [Symbol.dispose]: installFileEditorTyping({
        root: screen.getByTestId("file-surface").element() as HTMLElement,
        path: "index.html",
        getEditor: () => editor ?? null,
      }),
    };
    const content = screen.container
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-content]");
    expect(content).toBeTruthy();
    const input = (inputType: string, data: string | null = null) =>
      content!.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType,
          data,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );

    editor!.setSelections([
      { start: { line: 0, character: 4 }, end: { line: 0, character: 4 }, direction: "none" },
    ]);
    input("insertText", ">");
    expect(editor!.getText()).toBe("<div></div>\n");
    input("insertParagraph");
    expect(editor!.getText()).toBe("<div>\n  \n</div>\n");
    input("insertText", "p");
    expect(editor!.getText()).toBe("<div>\n  p\n</div>\n");

    editor!.undo();
    editor!.undo();
    expect(editor!.getText()).toBe("<div></div>\n");
  });
});
