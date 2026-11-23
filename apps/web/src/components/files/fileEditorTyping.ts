import {
  planTyping,
  type TypingDocument,
  type TypingEdit,
  type TypingInput,
  type TypingRange,
  typingLanguageForPath,
} from "./fileEditorTyping.logic";

interface TypingEditor {
  getEditState(): { document: TypingDocument } | undefined;
  getViewState(): { selections?: readonly TypingRange[] };
  applyEdits(edits: TypingEdit[]): void;
  setSelections(selections: (TypingRange & { direction: "none" })[]): void;
}

interface FileEditorTypingOptions {
  root: HTMLElement;
  path: string;
  getEditor: () => TypingEditor | null;
}

function typingInput(event: InputEvent): TypingInput | null {
  switch (event.inputType) {
    case "insertText":
      return event.data !== null && event.data.length === 1
        ? { kind: "text", text: event.data }
        : null;
    case "insertParagraph":
    case "insertLineBreak":
      return { kind: "enter" };
    case "deleteContentBackward":
      return { kind: "backspace" };
    default:
      return null;
  }
}

/** Runs before the editor's own `beforeinput` handler, which lives inside the file's shadow root. */
export function installFileEditorTyping({
  root,
  path,
  getEditor,
}: FileEditorTypingOptions): () => void {
  const language = typingLanguageForPath(path);
  const handleBeforeInput = (event: InputEvent) => {
    if (event.isComposing) return;
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement) || !target.hasAttribute("data-content")) return;
    const input = typingInput(event);
    const editor = getEditor();
    const state = input === null ? undefined : editor?.getEditState();
    // The live selections; the edit state's copy can lag while the file is on screen.
    const selections = state === undefined ? undefined : editor?.getViewState().selections;
    if (input === null || editor === null || state === undefined || selections === undefined)
      return;
    const plan = planTyping(state.document, selections, input, language);
    if (plan === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (plan.edits.length > 0) editor.applyEdits(plan.edits);
    editor.setSelections(plan.selections.map((range) => ({ ...range, direction: "none" })));
  };
  root.addEventListener("beforeinput", handleBeforeInput, true);
  return () => root.removeEventListener("beforeinput", handleBeforeInput, true);
}
