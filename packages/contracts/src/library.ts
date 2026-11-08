import * as Schema from "effect/Schema";

export const LibraryCategory = Schema.Literals([
  "deck",
  "design",
  "writing",
  "video",
  "application",
  "other",
]);
export type LibraryCategory = typeof LibraryCategory.Type;

/** Something an agent made: a Studio set in a project, or a gs-jobs application folder. */
export const LibraryItem = Schema.Struct({
  /** `studio:<folder>` or `career:<application id>`; stable while the item stays put. */
  id: Schema.String,
  source: Schema.Literals(["studio", "career"]),
  category: LibraryCategory,
  title: Schema.String,
  /** The item's folder on the environment's machine. */
  path: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  projectTitle: Schema.NullOr(Schema.String),
  /** Workspace-relative set folder, as Studio opens it; null for applications. */
  setPath: Schema.NullOr(Schema.String),
  optionCount: Schema.Number,
  picked: Schema.NullOr(Schema.String),
  /** File kinds of the options, such as `html` or `video`. */
  kinds: Schema.Array(Schema.String),
  updatedAt: Schema.String,
  sizeBytes: Schema.Number,
  threadId: Schema.NullOr(Schema.String),
  threadTitle: Schema.NullOr(Schema.String),
});
export type LibraryItem = typeof LibraryItem.Type;

export const LibraryTrashItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: LibraryCategory,
  deletedAt: Schema.String,
  sizeBytes: Schema.Number,
});
export type LibraryTrashItem = typeof LibraryTrashItem.Type;

/** Read from files on the environment's machine; no agent turn runs. */
export const LibraryReport = Schema.Struct({
  items: Schema.Array(LibraryItem),
  /** Deleted items, restorable until they are emptied or 30 days pass. */
  trash: Schema.Array(LibraryTrashItem),
});
export type LibraryReport = typeof LibraryReport.Type;

export const LibraryIdsInput = Schema.Struct({ ids: Schema.Array(Schema.String) });
export type LibraryIdsInput = typeof LibraryIdsInput.Type;

export class LibraryError extends Schema.TaggedError<LibraryError>()("LibraryError", {
  reason: Schema.Literals(["unknownItem", "moveFailed", "restoreConflict"]),
}) {}
