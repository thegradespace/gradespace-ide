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
