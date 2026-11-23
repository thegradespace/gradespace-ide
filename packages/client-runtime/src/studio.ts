import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import {
  isWorkspaceBrowserPreviewPath,
  isWorkspaceImagePreviewPath,
} from "@t3tools/shared/filePreview";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const STUDIO_ROOT = ".gradespace/studio";
export const STUDIO_MANIFEST_NAME = "studio.json";

const StudioRevision = Schema.Struct({
  file: Schema.String,
  note: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
});
export type StudioRevision = typeof StudioRevision.Type;

/** Editor timeline files for a video rough cut, beside its preview `file`. */
const StudioTimeline = Schema.Struct({
  fcpxml: Schema.optional(Schema.String),
  xml: Schema.optional(Schema.String),
  edl: Schema.optional(Schema.String),
});
export type StudioTimeline = typeof StudioTimeline.Type;
export type StudioTimelineFormat = keyof StudioTimeline;

const StudioVariant = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  note: Schema.optional(Schema.String),
  file: Schema.String,
  /** Earlier versions, oldest first. `file` is always the latest. */
  revisions: Schema.optional(Schema.Array(StudioRevision)),
  timeline: Schema.optional(StudioTimeline),
});
export type StudioVariant = typeof StudioVariant.Type;

const StudioManifest = Schema.Struct({
  title: Schema.String,
  recommended: Schema.optional(Schema.String),
  picked: Schema.optional(Schema.String),
  /** Hidden from Studio's set list until "Show archived"; Library still lists it. */
  archived: Schema.optional(Schema.Literal(true)),
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

const TIMELINE_EXTENSIONS: Record<StudioTimelineFormat, RegExp> = {
  fcpxml: /\.fcpxml$/i,
  xml: /\.xml$/i,
  edl: /\.edl$/i,
};

/** Like revisions, a bad timeline entry is dropped; the preview still shows. */
function cleanTimeline(value: unknown): StudioTimeline | null {
  const timeline = asRecord(value);
  if (timeline === null) return null;
  const clean = Object.fromEntries(
    (Object.keys(TIMELINE_EXTENSIONS) as StudioTimelineFormat[]).flatMap((format) => {
      const file = timeline[format];
      return typeof file === "string" &&
        staysInsideSet(file) &&
        TIMELINE_EXTENSIONS[format].test(file)
        ? [[format, file]]
        : [];
    }),
  );
  return Object.keys(clean).length === 0 ? null : clean;
}

function withCleanExtras(input: Record<string, unknown>): Record<string, unknown> {
  // Like revisions, an odd archived value is ignored rather than failing the set.
  const { archived, ...manifest } = input;
  if (archived === true) manifest.archived = true;
  if (!Array.isArray(manifest.variants)) return manifest;
  return {
    ...manifest,
    variants: manifest.variants.map((entry: unknown) => {
      const variant = asRecord(entry);
      if (variant === null) return entry;
      const { revisions, timeline, ...rest } = variant;
      const clean = cleanRevisions(revisions);
      const cleanTimelineFiles = cleanTimeline(timeline);
      return {
        ...rest,
        ...(clean.length === 0 ? {} : { revisions: clean }),
        ...(cleanTimelineFiles === null ? {} : { timeline: cleanTimelineFiles }),
      };
    }),
  };
}

/** Set folders directly under the Studio root, newest first: folder names start with their date. */
export function studioSetPaths(
  entries: ReadonlyArray<{ readonly path: string; readonly kind: string }>,
): string[] {
  return entries
    .filter(
      (entry) =>
        entry.kind === "directory" &&
        entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))) === STUDIO_ROOT,
    )
    .map((entry) => entry.path)
    .sort((left, right) => right.localeCompare(left));
}

export function parseStudioManifest(contents: string): StudioManifest | null {
  const raw = parseJsonObject(contents);
  const manifest = Option.getOrNull(decodeManifest(raw === null ? null : withCleanExtras(raw)));
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

/** Keeps unknown fields, like `withStudioPicked`; unarchiving removes the flag. */
export function withStudioArchived(contents: string, archived: boolean): string | null {
  const manifest = parseJsonObject(contents);
  if (manifest === null) return null;
  const { archived: _previous, ...rest } = manifest;
  return `${JSON.stringify(archived ? { ...rest, archived: true } : rest, null, 2)}\n`;
}

export interface StudioSetSummary {
  readonly path: string;
  /** Null while the set's studio.json is loading or cannot be read. */
  readonly title: string | null;
  readonly archived: boolean;
}

/**
 * Sets matching every word of the query in their title or folder name, keeping their order.
 * Archived sets are left out unless `showArchived`; `archivedCount` counts them all.
 */
export function filterStudioSets(
  sets: ReadonlyArray<StudioSetSummary>,
  filter: { readonly query: string; readonly showArchived: boolean },
): { readonly shown: ReadonlyArray<StudioSetSummary>; readonly archivedCount: number } {
  const words = filter.query.toLowerCase().split(/\s+/u).filter(Boolean);
  const shown = sets.filter((set) => {
    if (set.archived && !filter.showArchived) return false;
    const haystack = `${set.title ?? ""} ${set.path.split("/").at(-1) ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  return { shown, archivedCount: sets.filter((set) => set.archived).length };
}

export type StudioVariantKind = "html" | "pdf" | "image" | "video" | "text" | "other";

export function studioVariantKind(file: string): StudioVariantKind {
  if (/\.pdf$/i.test(file)) return "pdf";
  if (/\.(mp4|m4v|webm|mov)$/i.test(file)) return "video";
  if (isWorkspaceBrowserPreviewPath(file)) return "html";
  if (isWorkspaceImagePreviewPath(file)) return "image";
  return /\.(?:md|mdx|markdown|mdown|mkd|txt)$/i.test(file) ? "text" : "other";
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
  /** Set when a client left it through a share link: the name they gave. */
  readonly author?: string | undefined;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const percent = (fraction: number) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;

/** `m:ss.t`, or `h:mm:ss.t` from an hour, rounded down to the tenth. */
export function studioPlaybackTime(seconds: number): string {
  const tenths = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds * 10)) : 0;
  const total = Math.floor(tenths / 10);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = `${String(total % 60).padStart(2, "0")}.${tenths % 10}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

function studioPinSpot(pin: StudioPinNote): string {
  const { page, video } = pin;
  if (video !== undefined) {
    return `at ${studioPlaybackTime(video.time)}, about ${percent(video.x)} from the left and ${percent(video.y)} from the top of the video frame`;
  }
  if (page === null) {
    return `about ${percent(pin.fx)} from the left and ${percent(pin.fy)} from the top of the visible area`;
  }
  return [
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
}

export function studioPinLine(variant: StudioVariant, pin: StudioPinNote): string {
  const option = `Option ${studioOptionLabel(variant, pin.version)}`;
  const spot = studioPinSpot(pin);
  return pin.author === undefined
    ? `${option}, pin ${pin.number} (${spot}): ${oneLine(pin.comment)}`
    : `${option}, client pin ${pin.number} via share link (${spot}): ${oneLine(pin.author)} (client): ${oneLine(pin.comment)}`;
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
  ].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
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

/**
 * The id a new option should take: the letter after the set's last single-letter id, or the
 * first unused letter. Null when the set does not use letters or has run out of them.
 */
export function studioNextOptionId(manifest: StudioManifest): string | null {
  const ids = new Set(manifest.variants.map((variant) => variant.id));
  const letters = [...ids].filter((id) => /^[A-Za-z]$/.test(id));
  if (letters.length === 0) return null;
  const upper = letters.every((id) => id === id.toUpperCase());
  const last = Math.max(...letters.map((id) => id.toUpperCase().charCodeAt(0)));
  const codes = [
    ...Array.from({ length: 90 - last }, (_, index) => last + 1 + index),
    ...Array.from({ length: last - 65 }, (_, index) => 65 + index),
  ];
  const free = codes
    .map((code) => String.fromCharCode(code))
    .map((letter) => (upper ? letter : letter.toLowerCase()))
    .find((id) => !ids.has(id));
  return free ?? null;
}

/** A part of one option to keep in a mix: a pin placed in Mix mode, whose comment is the note. */
export interface StudioMixPart {
  readonly variant: StudioVariant;
  readonly pin: StudioPinNote;
}

const mixPrefix = (manifest: StudioManifest) => `Studio mix for "${manifest.title}":`;
const MIX_PART_START = "- Option ";
const MIX_CLOSING_START = "Add the new option to ";

const versionLabel = (variant: StudioVariant, version: StudioViewedVersion) =>
  version === null ? `v${studioLatestVersion(variant)} (latest)` : `v${version}`;

/**
 * Asks the agent for a new option made of parts kept from others, listed in set order. Replaces
 * an earlier mix request for the same set, so mixing again does not send two.
 */
export function withStudioMixRequest(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  parts: readonly StudioMixPart[],
): string {
  const prefix = mixPrefix(manifest);
  const lines = prompt.split("\n");
  const start = lines.findIndex((line) => line.startsWith(prefix));
  const partsEnd =
    start === -1
      ? -1
      : lines.findIndex((line, index) => index > start && !line.startsWith(MIX_PART_START));
  const end =
    start === -1
      ? -1
      : partsEnd === -1
        ? lines.length
        : lines[partsEnd]!.startsWith(MIX_CLOSING_START)
          ? partsEnd + 1
          : partsEnd;
  const kept = start === -1 ? lines : [...lines.slice(0, start), ...lines.slice(end)];
  const body = kept.join("\n").trimEnd();
  if (parts.length === 0) return body;
  const order = new Map(manifest.variants.map((variant, index) => [variant.id, index]));
  const sorted = [...parts].sort(
    (a, b) =>
      (order.get(a.variant.id) ?? 0) - (order.get(b.variant.id) ?? 0) ||
      (a.pin.version ?? Infinity) - (b.pin.version ?? Infinity) ||
      a.pin.number - b.pin.number,
  );
  const nextId = studioNextOptionId(manifest);
  const request = [
    `${prefix} make one new option that combines these parts.`,
    ...sorted.map(({ variant, pin }) => {
      const note = oneLine(pin.comment);
      return `${MIX_PART_START}${variant.id} ${versionLabel(variant, pin.version)} (${setPath}/${studioVersionFile(variant, pin.version)}), pin ${pin.number} (${studioPinSpot(pin)})${note.length > 0 ? `: ${note}` : ""}`;
    }),
    `${MIX_CLOSING_START}${setPath}/${STUDIO_MANIFEST_NAME} as ${nextId === null ? "the next option" : `option ${nextId}`}, with a title and a note that says which part came from which option, and set "recommended" to ${nextId === null ? "its id" : `"${nextId}"`}. Leave the other options as they are.`,
  ].join("\n");
  return body.length === 0 ? request : `${body}\n${request}`;
}

/** One problem the automatic checks found in an option. */
export interface StudioCheckIssueNote {
  readonly message: string;
  readonly selector: string | null;
}

/** Asks the agent to fix what the checks found in one option, at the version they ran on. */
export function withStudioFixRequest(
  prompt: string,
  manifest: StudioManifest,
  setPath: string,
  variant: StudioVariant,
  version: StudioViewedVersion,
  issues: readonly StudioCheckIssueNote[],
): string {
  if (issues.length === 0) return prompt;
  const request = [
    `Studio checks on option ${studioOptionLabel(variant, version)} of "${manifest.title}" (${setPath}/${studioVersionFile(variant, version)}) found ${issues.length === 1 ? "1 issue" : `${issues.length} issues`}. Fix them in this option and leave the rest of the design as it is:`,
    ...issues.map(
      (issue) =>
        `- ${oneLine(issue.message)}${issue.selector === null || issue.selector.length === 0 ? "" : ` (${oneLine(issue.selector)})`}`,
    ),
  ].join("\n");
  const body = prompt.trimEnd();
  return body.length === 0 ? request : `${body}\n${request}`;
}

const STUDIO_SET_FOLDER = new RegExp(`^${STUDIO_ROOT.replaceAll(".", "\\.")}/([^/]+)(?:/|$)`, "u");

/**
 * The Studio set folder a file sits in, workspace-relative, or null. Accepts a workspace-relative
 * path, a `./`-prefixed one, or an absolute one inside `cwd`.
 */
export function studioSetPathForFile(path: string, cwd: string | null | undefined): string | null {
  const normalized = path.replaceAll("\\", "/");
  const root = cwd?.replaceAll("\\", "/").replace(/\/+$/u, "");
  const relative =
    root !== undefined && root !== "" && normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized.replace(/^\.\//u, "");
  const match = STUDIO_SET_FOLDER.exec(relative);
  return match === null ? null : `${STUDIO_ROOT}/${match[1]}`;
}

const WRITING_ITEM_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "waiting",
  "completed",
]);

/** The Studio set a run wrote to last, workspace-relative, or null; deletions do not count. */
export function latestStudioSetWrittenByRun(
  rows: ReadonlyArray<Pick<OrchestrationV2ProjectedTurnItem, "item" | "visibility">>,
  runId: string,
  cwd: string | null,
): string | null {
  let latest: string | null = null;
  for (const { item, visibility } of rows) {
    if (
      item.type !== "file_change" ||
      item.runId !== runId ||
      visibility === "inherited" ||
      !WRITING_ITEM_STATUSES.has(item.status)
    ) {
      continue;
    }
    const changes = item.changes?.length
      ? item.changes
      : [{ path: item.fileName, operation: "edit" }];
    for (const change of changes) {
      if (/^(?:delete|deleted|remove)$/iu.test(change.operation)) continue;
      latest = studioSetPathForFile(change.path, cwd) ?? latest;
    }
  }
  return latest;
}

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export interface StudioObservedRun {
  /** The thread being watched; a switch to another thread never counts as a finish. */
  readonly identity: string | null;
  readonly runId: string | null;
  readonly status: string | null;
}

/** The run that was seen going from active to completed, or null; a run already done when first seen is not. */
export function studioRunFinishedWhileWatched(
  previous: StudioObservedRun,
  next: StudioObservedRun,
): string | null {
  return previous.identity === next.identity &&
    next.runId !== null &&
    next.runId === previous.runId &&
    next.status === "completed" &&
    previous.status !== null &&
    ACTIVE_RUN_STATUSES.has(previous.status)
    ? next.runId
    : null;
}
