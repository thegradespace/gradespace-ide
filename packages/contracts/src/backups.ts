import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Dated backups are rotated; other `statev2-*.sqlite` files in the folder are never touched. */
export const DATED_BACKUP_FILE_PATTERN = /^statev2-\d{4}-\d{2}-\d{2}\.sqlite$/;

export const BackupEntry = Schema.Struct({
  fileName: TrimmedNonEmptyString,
  createdAt: Schema.String,
  sizeBytes: NonNegativeInt,
});
export type BackupEntry = typeof BackupEntry.Type;

export const BackupStatus = Schema.Struct({
  directory: Schema.String,
  backups: Schema.Array(BackupEntry),
  lastBackupAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  pendingRestore: Schema.NullOr(TrimmedNonEmptyString),
});
export type BackupStatus = typeof BackupStatus.Type;

export const BackupRestoreInput = Schema.Struct({ fileName: TrimmedNonEmptyString });
export type BackupRestoreInput = typeof BackupRestoreInput.Type;

export class BackupError extends Schema.TaggedError<BackupError>()("BackupError", {
  reason: Schema.Literals(["backupFailed", "unknownBackup", "restoreFailed"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "backupFailed":
        return "Could not back up your chats.";
      case "unknownBackup":
        return "That backup no longer exists.";
      case "restoreFailed":
        return "Could not schedule the restore.";
    }
  }
}
