import {
  isWorkspaceBrowserPreviewPath,
  isWorkspaceImagePreviewPath,
} from "@t3tools/shared/filePreview";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isMarkdownPreviewFile } from "../files/filePreviewMode";

export const STUDIO_ROOT = ".gradespace/studio";
export const STUDIO_MANIFEST_NAME = "studio.json";

const StudioVariant = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  note: Schema.optional(Schema.String),
  file: Schema.String,
});
export type StudioVariant = typeof StudioVariant.Type;

const StudioManifest = Schema.Struct({
  title: Schema.String,
  recommended: Schema.optional(Schema.String),
  picked: Schema.optional(Schema.String),
  variants: Schema.Array(StudioVariant),
});
export type StudioManifest = typeof StudioManifest.Type;

const decodeManifest = Schema.decodeUnknownOption(StudioManifest);

// Outside-the-set paths would resolve to the host media resource, which can read any file.
const staysInsideSet = (file: string) =>
  file.length > 0 &&
  !file.startsWith("/") &&
  !file.includes("\\") &&
  !file.includes(":") &&
  !file.split("/").includes("..");

function parseJsonObject(contents: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(contents);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseStudioManifest(contents: string): StudioManifest | null {
  const manifest = Option.getOrNull(decodeManifest(parseJsonObject(contents)));
  if (manifest === null || manifest.variants.length === 0) return null;
  const ids = new Set(manifest.variants.map((variant) => variant.id));
  if (ids.size !== manifest.variants.length) return null;
  return manifest.variants.every((variant) => staysInsideSet(variant.file)) ? manifest : null;
}

/** Keeps fields this version does not know about, because the skills also write this file. */
export function withStudioPicked(contents: string, picked: string | null): string | null {
  const manifest = parseJsonObject(contents);
  if (manifest === null) return null;
  const { picked: _previous, ...rest } = manifest;
  return `${JSON.stringify(picked === null ? rest : { ...rest, picked }, null, 2)}\n`;
}

export type StudioVariantKind = "html" | "pdf" | "image" | "text" | "other";

export function studioVariantKind(file: string): StudioVariantKind {
  if (/\.pdf$/i.test(file)) return "pdf";
  if (isWorkspaceBrowserPreviewPath(file)) return "html";
  if (isWorkspaceImagePreviewPath(file)) return "image";
  return isMarkdownPreviewFile(file) || /\.txt$/i.test(file) ? "text" : "other";
}

const pickPrefix = (manifest: StudioManifest) => `Studio pick for "${manifest.title}":`;

/** Replaces the set's earlier pick line, so changing your mind does not send two picks. */
export function withStudioPickLine(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant | null,
): string {
  const prefix = pickPrefix(manifest);
  const kept = prompt.split("\n").filter((line) => !line.startsWith(prefix));
  const body = kept.join("\n").trimEnd();
  if (variant === null) return body;
  const line = `${prefix} option ${variant.id}, ${setPath}/${variant.file}. Refine only this one.`;
  return body.length === 0 ? line : `${body}\n${line}`;
}

export function withStudioComment(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant,
  comment: string,
): string {
  const line = `Studio comment on option ${variant.id} of "${manifest.title}" (${setPath}/${variant.file}): ${comment.trim()}`;
  const body = prompt.trimEnd();
  return body.length === 0 ? line : `${body}\n${line}`;
}

/** The option shown beside `leadId` in Compare: the recommended one, else the next, wrapping. */
export function studioCompareDefault(
  manifest: StudioManifest,
  leadId: string,
): StudioVariant | null {
  const others = manifest.variants.filter((variant) => variant.id !== leadId);
  const recommended = others.find((variant) => variant.id === manifest.recommended);
  if (recommended !== undefined) return recommended;
  const index = manifest.variants.findIndex((variant) => variant.id === leadId);
  return manifest.variants[(index + 1) % manifest.variants.length] ?? null;
}

/** A comment pinned to a spot. `page` is set when the design's bridge reported the spot's element. */
export interface StudioPinNote {
  readonly number: number;
  readonly comment: string;
  /** Where in the visible area the pin was placed, 0..1. */
  readonly fx: number;
  readonly fy: number;
  readonly page: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly selector: string;
    readonly text: string;
  } | null;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const percent = (fraction: number) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;

export function studioPinLine(variant: StudioVariant, pin: StudioPinNote): string {
  const { page } = pin;
  const spot =
    page === null
      ? `about ${percent(pin.fx)} from the left and ${percent(pin.fy)} from the top of the visible area`
      : [
          [
            page.text.length > 0 ? `near "${oneLine(page.text).replaceAll('"', "'")}"` : "",
            page.selector.length > 0 ? `(${oneLine(page.selector)})` : "",
          ]
            .filter((part) => part.length > 0)
            .join(" "),
          `about ${percent(page.width > 0 ? page.x / page.width : 0)} from the left and ${percent(page.height > 0 ? page.y / page.height : 0)} from the top of the page`,
        ]
          .filter((part) => part.length > 0)
          .join(", ");
  return `Option ${variant.id}, pin ${pin.number} (${spot}): ${oneLine(pin.comment)}`;
}

/** Adds the free comment and pinned comments for one option; pins alone read as a short list. */
export function withStudioFeedback(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant,
  feedback: { readonly comment: string; readonly pins: readonly StudioPinNote[] },
): string {
  const comment = feedback.comment.trim();
  if (feedback.pins.length === 0) {
    return comment.length === 0
      ? prompt
      : withStudioComment(prompt, manifest, setPath, variant, comment);
  }
  const lines = [
    `Studio comments on option ${variant.id} of "${manifest.title}" (${setPath}/${variant.file}):`,
    ...(comment.length === 0 ? [] : [`Option ${variant.id}, overall: ${comment}`]),
    ...feedback.pins.map((pin) => studioPinLine(variant, pin)),
  ];
  const body = prompt.trimEnd();
  return body.length === 0 ? lines.join("\n") : `${body}\n${lines.join("\n")}`;
}
