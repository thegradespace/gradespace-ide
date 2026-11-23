import type { TypingDocument, TypingEdit, TypingRange } from "./fileEditorTyping.logic";
import { collectWordSuggestions, wordLanguageForPath } from "./fileEditorWordSuggestions.logic";

interface WordSuggestionEditor {
  getEditState(): { document: TypingDocument } | undefined;
  getViewState(): { selections?: readonly TypingRange[] };
  applyEdits(edits: TypingEdit[]): void;
  setSelections(selections: (TypingRange & { direction: "none" })[]): void;
}

interface Open {
  readonly line: number;
  readonly start: number;
  readonly words: readonly string[];
  active: number;
}

const LIST_CLASS =
  "fixed z-50 min-w-40 max-w-80 overflow-hidden rounded-md border border-border bg-popover py-1 font-mono text-xs text-popover-foreground shadow-md";
const ITEM_CLASS = "cursor-pointer truncate px-2 py-0.5";
const ACTIVE_ITEM_CLASS = `${ITEM_CLASS} bg-accent text-accent-foreground`;

const isContentEvent = (event: Event) => {
  const target = event.composedPath()[0];
  return target instanceof HTMLElement && target.hasAttribute("data-content");
};

function caretRect(): DOMRect | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return rect.height === 0 && rect.top === 0 ? null : rect;
}

/** Shows a list of words from the file and the language while typing; Enter or Tab inserts one. */
export function installFileEditorWordSuggestions({
  root,
  path,
  getEditor,
}: {
  root: HTMLElement;
  path: string;
  getEditor: () => WordSuggestionEditor | null;
}): () => void {
  const language = wordLanguageForPath(path);
  if (!language.enabled) return () => {};
  const list = document.createElement("div");
  list.className = LIST_CLASS;
  list.setAttribute("role", "listbox");
  list.dataset.fileEditorSuggestions = "";
  let open: Open | null = null;
  let frame: number | null = null;

  const close = () => {
    open = null;
    list.remove();
  };

  const render = () => {
    if (open === null) return;
    const rect = caretRect();
    if (rect === null) return close();
    list.replaceChildren(
      ...open.words.map((word, index) => {
        const item = document.createElement("div");
        item.className = index === open!.active ? ACTIVE_ITEM_CLASS : ITEM_CLASS;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(index === open!.active));
        item.textContent = word;
        item.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          accept(index);
        });
        return item;
      }),
    );
    if (!list.isConnected) document.body.append(list);
    const below = rect.bottom + 2;
    const height = list.offsetHeight;
    list.style.left = `${Math.min(rect.left, window.innerWidth - list.offsetWidth - 8)}px`;
    list.style.top = `${below + height > window.innerHeight ? rect.top - height - 2 : below}px`;
  };

  const refresh = () => {
    frame = null;
    const editor = getEditor();
    const state = editor?.getEditState();
    const selections = editor?.getViewState().selections;
    const caret = selections?.length === 1 ? selections[0]! : null;
    if (
      state === undefined ||
      caret === null ||
      caret.start.line !== caret.end.line ||
      caret.start.character !== caret.end.character
    )
      return close();
    const found = collectWordSuggestions(state.document, caret.end, language);
    if (found === null) return close();
    open = { line: caret.end.line, start: found.start, words: found.words, active: 0 };
    render();
  };

  // The editor applies the input and moves the native selection after this event finishes.
  const scheduleRefresh = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  };

  function accept(index: number) {
    const editor = getEditor();
    const caret = editor?.getViewState().selections?.[0];
    const current = open;
    close();
    if (editor === null || caret === undefined || current === null) return;
    const word = current.words[index]!;
    const start = { line: current.line, character: current.start };
    editor.applyEdits([{ range: { start, end: caret.end }, newText: word }]);
    const end = { line: current.line, character: current.start + word.length };
    editor.setSelections([{ start: end, end, direction: "none" }]);
  }

  const handleBeforeInput = (event: InputEvent) => {
    if (!isContentEvent(event) || event.isComposing) return;
    const typedWordChar =
      event.inputType === "insertText" && event.data !== null && /^[\w$-]$/.test(event.data);
    if (typedWordChar || (open !== null && event.inputType === "deleteContentBackward"))
      scheduleRefresh();
    else close();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (open === null || !isContentEvent(event) || event.isComposing) return;
    const move = (delta: number) => {
      open!.active = (open!.active + delta + open!.words.length) % open!.words.length;
      render();
    };
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) accept(open.active);
    else if (event.key === "Escape") close();
    else {
      if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") close();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  root.addEventListener("beforeinput", handleBeforeInput, true);
  root.addEventListener("keydown", handleKeyDown, true);
  root.addEventListener("pointerdown", close, true);
  root.addEventListener("focusout", close, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    close();
    root.removeEventListener("beforeinput", handleBeforeInput, true);
    root.removeEventListener("keydown", handleKeyDown, true);
    root.removeEventListener("pointerdown", close, true);
    root.removeEventListener("focusout", close, true);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
  };
}
