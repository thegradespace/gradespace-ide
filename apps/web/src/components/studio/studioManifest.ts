import {
  isWorkspaceBrowserPreviewPath,
  isWorkspaceImagePreviewPath,
} from "@t3tools/shared/filePreview";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isMarkdownPreviewFile } from "../files/filePreviewMode";

export const STUDIO_ROOT = ".gradespace/studio";
export const STUDIO_MANIFEST_NAME = "studio.json";

const StudioRevision = Schema.Struct({
  file: Schema.String,
  note: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
});
export type StudioRevision = typeof StudioRevision.Type;

const StudioVariant = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  note: Schema.optional(Schema.String),
  file: Schema.String,
  /** Earlier versions, oldest first. `file` is always the latest. */
  revisions: Schema.optional(Schema.Array(StudioRevision)),
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Revisions are a courtesy: a malformed entry is dropped rather than failing the whole set. */
function cleanRevisions(value: unknown): StudioRevision[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const revision = asRecord(entry);
    if (typeof revision?.file !== "string" || !staysInsideSet(revision.file)) return [];
    const { file, note, createdAt } = revision;
    return [
      {
        file,
        ...(typeof note === "string" ? { note } : {}),
        ...(typeof createdAt === "string" ? { createdAt } : {}),
      },
    ];
  });
}

function withCleanRevisions(manifest: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(manifest.variants)) return manifest;
  return {
    ...manifest,
    variants: manifest.variants.map((entry: unknown) => {
      const variant = asRecord(entry);
      if (variant === null) return entry;
      const { revisions, ...rest } = variant;
      const clean = cleanRevisions(revisions);
      return clean.length === 0 ? rest : { ...rest, revisions: clean };
    }),
  };
}

export function parseStudioManifest(contents: string): StudioManifest | null {
  const raw = parseJsonObject(contents);
  const manifest = Option.getOrNull(decodeManifest(raw === null ? null : withCleanRevisions(raw)));
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

export type StudioVariantKind = "html" | "pdf" | "image" | "video" | "text" | "other";

export function studioVariantKind(file: string): StudioVariantKind {
  if (/\.pdf$/i.test(file)) return "pdf";
  if (/\.(mp4|m4v|webm|mov)$/i.test(file)) return "video";
  if (isWorkspaceBrowserPreviewPath(file)) return "html";
  if (isWorkspaceImagePreviewPath(file)) return "image";
  return isMarkdownPreviewFile(file) || /\.txt$/i.test(file) ? "text" : "other";
}

/**
 * Earlier versions are v1, v2... in the order listed, and the variant's own file is the latest.
 * A viewed version is the number of an earlier one, or null for the latest.
 */
export type StudioViewedVersion = number | null;

export const studioLatestVersion = (variant: StudioVariant) => (variant.revisions?.length ?? 0) + 1;

/** Falls back to the latest when the requested version is not an earlier one that exists. */
export function studioViewedVersion(
  variant: StudioVariant,
  requested: number | undefined,
): StudioViewedVersion {
  return requested !== undefined &&
    Number.isInteger(requested) &&
    requested >= 1 &&
    requested < studioLatestVersion(variant)
    ? requested
    : null;
}

const studioVersionFile = (variant: StudioVariant, version: StudioViewedVersion) =>
  version === null ? variant.file : (variant.revisions?.[version - 1]?.file ?? variant.file);

/** The variant as it looked at `version`, so previews and exports can treat it like any other. */
export const studioShownVariant = (
  variant: StudioVariant,
  version: StudioViewedVersion,
): StudioVariant =>
  version === null ? variant : { ...variant, file: studioVersionFile(variant, version) };

const fileNamePart = (text: string) => text.replace(/[^\w.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");

/** `<set-folder>-<option>.<ext>`, with `-v<N>` once the option has more than one version. */
export function studioDownloadFileName(
  setPath: string,
  variant: StudioVariant,
  version: StudioViewedVersion,
  extension: string,
): string {
  const set = fileNamePart(setPath.split("/").at(-1) ?? "") || "design";
  const option = fileNamePart(variant.id) || "option";
  const latest = studioLatestVersion(variant);
  const suffix = latest > 1 ? `-v${version ?? latest}` : "";
  return `${set}-${option}${suffix}.${extension}`;
}

const studioOptionLabel = (variant: StudioVariant, version: StudioViewedVersion) =>
  version === null ? variant.id : `${variant.id} v${version}`;

const pickPrefix = (manifest: StudioManifest) => `Studio pick for "${manifest.title}":`;

/** Replaces the set's earlier pick line, so changing your mind does not send two picks. */
export function withStudioPickLine(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant | null,
  version: StudioViewedVersion = null,
): string {
  const prefix = pickPrefix(manifest);
  const kept = prompt.split("\n").filter((line) => !line.startsWith(prefix));
  const body = kept.join("\n").trimEnd();
  if (variant === null) return body;
  const line =
    version === null
      ? `${prefix} option ${variant.id}, ${setPath}/${variant.file}. Refine only this one.`
      : `${prefix} option ${variant.id}, picked while viewing its earlier version v${version} (${setPath}/${studioVersionFile(variant, version)}). Refine only this one.`;
  return body.length === 0 ? line : `${body}\n${line}`;
}

const restorePrefix = (manifest: StudioManifest, variant: StudioVariant) =>
  `Studio restore for "${manifest.title}": restore option ${variant.id} to `;

/** The agent does the restore, like it does the edits; a newer restore replaces one for the same option. */
export function withStudioRestoreLine(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant,
  version: number,
): string {
  const prefix = restorePrefix(manifest, variant);
  const body = prompt
    .split("\n")
    .filter((line) => !line.startsWith(prefix))
    .join("\n")
    .trimEnd();
  const line = `${prefix}v${version} (${setPath}/${studioVersionFile(variant, version)}) as the latest version.`;
  return body.length === 0 ? line : `${body}\n${line}`;
}

export function withStudioComment(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant,
  comment: string,
  version: StudioViewedVersion = null,
): string {
  const line = `Studio comment on option ${studioOptionLabel(variant, version)} of "${manifest.title}" (${setPath}/${studioVersionFile(variant, version)}): ${comment.trim()}`;
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
  /** The earlier version it was placed on, or null for the latest. */
  readonly version: StudioViewedVersion;
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
  /** Set on a video: the playback time and where on the picture, 0..1. */
  readonly video?: { readonly time: number; readonly x: number; readonly y: number } | undefined;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const percent = (fraction: number) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;

/** `m:ss`, or `h:mm:ss` from an hour, rounded down to the second. */
export function studioPlaybackTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

export function studioPinLine(variant: StudioVariant, pin: StudioPinNote): string {
  const { page, video } = pin;
  const spot =
    video !== undefined
      ? `at ${studioPlaybackTime(video.time)}, about ${percent(video.x)} from the left and ${percent(video.y)} from the top of the video frame`
      : page === null
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
  return `Option ${studioOptionLabel(variant, pin.version)}, pin ${pin.number} (${spot}): ${oneLine(pin.comment)}`;
}

/**
 * Adds the free comment and pinned comments for one option. Pins on different versions are
 * listed under their own version; the free comment belongs to the version being viewed.
 */
export function withStudioFeedback(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant,
  feedback: {
    readonly comment: string;
    readonly version?: StudioViewedVersion;
    readonly pins: readonly StudioPinNote[];
  },
): string {
  const comment = feedback.comment.trim();
  const viewed = feedback.version ?? null;
  if (feedback.pins.length === 0) {
    return comment.length === 0
      ? prompt
      : withStudioComment(prompt, manifest, setPath, variant, comment, viewed);
  }
  const versions = [
    ...new Set([
      ...feedback.pins.map((pin) => pin.version),
      ...(comment.length > 0 ? [viewed] : []),
    ]),
  ].toSorted((a, b) => (a ?? Infinity) - (b ?? Infinity));
  const lines = versions.flatMap((version) => [
    `Studio comments on option ${studioOptionLabel(variant, version)} of "${manifest.title}" (${setPath}/${studioVersionFile(variant, version)}):`,
    ...(comment.length > 0 && version === viewed
      ? [`Option ${studioOptionLabel(variant, version)}, overall: ${comment}`]
      : []),
    ...feedback.pins
      .filter((pin) => pin.version === version)
      .map((pin) => studioPinLine(variant, pin)),
  ]);
  const body = prompt.trimEnd();
  return body.length === 0 ? lines.join("\n") : `${body}\n${lines.join("\n")}`;
}
