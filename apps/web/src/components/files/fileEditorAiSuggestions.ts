import type { EditPredictProvider, EditPredictResponse } from "@pierre/diffs/edit";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";

import {
  cursorAfterInsert,
  shouldSuggest,
  suggestionContext,
} from "./fileEditorAiSuggestions.logic";

/** The editor asks after 300ms; waiting longer keeps paid calls to real pauses. */
const EXTRA_IDLE_MS = 700;
/** After a failure (no model set up, signed out), stop asking for a while. */
const FAILURE_BACKOFF_MS = 60_000;

const EMPTY: EditPredictResponse = { edits: [], newCursor: { line: 0, character: 0 } };

export const AI_SUGGESTION_EXCLUDES = ["**/*.txt", "**/*.log", "**/*.csv", "**/*.tsv"];

function wait(ms: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(true), ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve(false);
      },
      { once: true },
    );
  });
}

export interface AiSuggestionTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly enabled: boolean;
}

export function createAiSuggestionProvider(target: {
  readonly current: AiSuggestionTarget;
}): EditPredictProvider {
  let pausedUntil = 0;
  let last: { readonly key: string; readonly text: string } | null = null;
  return {
    predict: async (request, { signal }) => {
      if (!target.current.enabled) return EMPTY;
      const context = suggestionContext(request);
      if (!shouldSuggest(context) || Date.now() < pausedUntil) return EMPTY;
      const key = `${request.path}\0${context.prefix}\0${context.suffix}`;
      let text = last?.key === key ? last.text : null;
      if (text === null) {
        if (!(await wait(EXTRA_IDLE_MS, signal)) || !target.current.enabled) return EMPTY;
        const { environmentId, cwd, relativePath } = target.current;
        const result = await runAtomCommand(
          appAtomRegistry,
          projectEnvironment.completeCode,
          {
            environmentId,
            input: { cwd, relativePath, prefix: context.prefix, suffix: context.suffix },
          },
          { signal, reportFailure: false, reportDefect: false },
        );
        if (result._tag !== "Success") {
          if (!signal.aborted) pausedUntil = Date.now() + FAILURE_BACKOFF_MS;
          return EMPTY;
        }
        text = result.value.text;
        last = { key, text };
      }
      if (text.length === 0) return EMPTY;
      return {
        edits: [{ range: { start: context.cursor, end: context.cursor }, newText: text }],
        newCursor: cursorAfterInsert(context.cursor, text),
      };
    },
  };
}
