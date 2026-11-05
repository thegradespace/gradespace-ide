import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const STUDIO_SHARE_DEFAULT_BASE_URL = "https://thegradespace.com";
export const STUDIO_SHARE_MAX_BYTES = 10 * 1024 * 1024;
const STUDIO_SHARE_MAX_TITLE_LENGTH = 120;
export const STUDIO_SHARE_FILE_PATTERN = /\.(html?|png|jpe?g|webp|gif|svg|pdf|md)$/i;

/** 0 never expires. */
export const StudioShareExpiryDays = Schema.Literals([1, 7, 30, 0]);
export type StudioShareExpiryDays = typeof StudioShareExpiryDays.Type;

/** Only whether a key is saved is ever sent to clients, never the key. */
export const StudioShareStatus = Schema.Struct({
  configured: Schema.Boolean,
  baseUrl: Schema.String,
});
export type StudioShareStatus = typeof StudioShareStatus.Type;

export const StudioShareSetTokenInput = Schema.Struct({
  /** Null removes the saved key. */
  token: Schema.NullOr(TrimmedNonEmptyString),
});
export type StudioShareSetTokenInput = typeof StudioShareSetTokenInput.Type;

export const StudioShareCreateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(STUDIO_SHARE_MAX_TITLE_LENGTH))),
  expiresInDays: StudioShareExpiryDays,
});
export type StudioShareCreateInput = typeof StudioShareCreateInput.Type;

export const StudioShareRevokeInput = Schema.Struct({ id: TrimmedNonEmptyString });
export type StudioShareRevokeInput = typeof StudioShareRevokeInput.Type;

export const StudioShareEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  title: Schema.String,
  fileName: Schema.String,
  contentType: Schema.String,
  sizeBytes: NonNegativeInt,
  createdAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  revoked: Schema.Boolean,
});
export type StudioShareEntry = typeof StudioShareEntry.Type;

export const StudioShareList = Schema.Struct({ shares: Schema.Array(StudioShareEntry) });
export type StudioShareList = typeof StudioShareList.Type;

export class StudioShareError extends Schema.TaggedError<StudioShareError>()("StudioShareError", {
  reason: Schema.Literals([
    "offline",
    "notConfigured",
    "notSetUpOnSite",
    "keyRejected",
    "unsupportedType",
    "outsideProject",
    "fileUnreadable",
    "tooLarge",
    "unreachable",
    "failed",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "offline":
        return "Offline mode is on. Turn it off in Settings to share.";
      case "notConfigured":
        return "Add your share key in Settings to share designs.";
      case "notSetUpOnSite":
        return "Sharing isn't set up on the website yet.";
      case "keyRejected":
        return "The share key was rejected. Check it in Settings.";
      case "unsupportedType":
        return "This kind of file can't be shared.";
      case "outsideProject":
        return "Only files inside the project can be shared.";
      case "fileUnreadable":
        return "Couldn't read the file to share.";
      case "tooLarge":
        return "This file is too big to share (10 MB max).";
      case "unreachable":
        return "Couldn't reach thegradespace.com.";
      case "failed":
        return "The website couldn't complete that. Try again.";
    }
  }
}
