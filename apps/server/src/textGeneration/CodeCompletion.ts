import {
  type ProjectCompleteCodeInput,
  type ProjectCompleteCodeResult,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "./TextGeneration.ts";

/** Suggests the text to insert at an editor caret, using the text generation model in Settings. */
export class CodeCompletion extends Context.Service<
  CodeCompletion,
  {
    readonly complete: (
      input: ProjectCompleteCodeInput,
    ) => Effect.Effect<ProjectCompleteCodeResult, TextGenerationError>;
  }
>()("t3/textGeneration/CodeCompletion") {}

function buildCodeCompletionPrompt(input: ProjectCompleteCodeInput): string {
  return `You are an inline code completion engine in a code editor. Continue the file "${input.relativePath}" at the caret.

Rules:
- Return only the text to insert at the caret, with no explanation and no Markdown fences.
- Do not repeat text that is already before or after the caret.
- Keep it short: finish the current line, or at most a few lines when a block is clearly started.
- Match the file's language, indentation and style.
- Return an empty string when nothing useful fits.
- Put the text in the "transcription" field of the JSON reply.

<before_caret>
${input.prefix}</before_caret>
<after_caret>
${input.suffix}</after_caret>`;
}

/** Strips fences and any echo of the line before the caret that models sometimes add. */
export function cleanCodeCompletion(raw: string, prefix: string): string {
  let text = raw.replace(/^\s*```[\w-]*\n?/, "").replace(/\n?```\s*$/, "");
  const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if (currentLine.trim().length > 0 && text.startsWith(currentLine))
    text = text.slice(currentLine.length);
  return text.trimEnd();
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration.TextGeneration;
  return CodeCompletion.of({
    complete: Effect.fn("CodeCompletion.complete")(
      function* (input) {
        const settings = yield* settingsService.getSettings;
        // Providers run in a working directory; the prompt already carries the code it needs.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "gs-code-complete-" });
        // The transcription operation is a plain prompt-to-text call that every provider implements.
        const generated = yield* textGeneration.generateTranscriptionPostProcessing({
          cwd,
          prompt: buildCodeCompletionPrompt(input),
          modelSelection: settings.textGenerationModelSelection,
        });
        return { text: cleanCodeCompletion(generated.transcription, input.prefix) };
      },
      Effect.scoped,
      Effect.mapError((cause) =>
        cause._tag === "TextGenerationError"
          ? cause
          : new TextGenerationError({
              operation: "completeCode",
              detail: "Could not prepare the suggestion request.",
              cause,
            }),
      ),
    ),
  });
});

export const layer = Layer.effect(CodeCompletion, make);
