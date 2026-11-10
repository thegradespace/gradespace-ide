import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const RestoreMarker = Schema.Struct({ fileName: Schema.String, requestedAt: Schema.String });
const RestoreMarkerJson = Schema.fromJsonString(RestoreMarker);
export const decodeRestoreMarker = Schema.decodeUnknownEffect(RestoreMarkerJson);
export const encodeRestoreMarker = Schema.encodeEffect(RestoreMarkerJson);

class InvalidRestoreMarkerError extends Schema.TaggedError<InvalidRestoreMarkerError>()(
  "InvalidRestoreMarkerError",
  {},
) {
  override get message() {
    return "The restore marker names an invalid backup.";
  }
}

class BackupIntegrityError extends Schema.TaggedError<BackupIntegrityError>()(
  "BackupIntegrityError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "The backup failed its integrity check.";
  }
}

/** Any `statev2-*.sqlite` in the backups folder can be restored; a name never carries a path. */
export const RESTORABLE_BACKUP_PATTERN = /^statev2-[\w.-]+\.sqlite$/;

export const backupsDirectory = (path: Path.Path, baseDir: string) => path.join(baseDir, "backups");

export const restoreMarkerPath = (path: Path.Path, dbPath: string) =>
  path.join(path.dirname(dbPath), "restore-pending.json");

const assertIntact = (filePath: string) => {
  const database = new NodeSqlite.DatabaseSync(filePath, { readOnly: true });
  try {
    const rows = database.prepare("PRAGMA integrity_check").all();
    const verdict = rows.length === 1 ? Object.values(rows[0] ?? {})[0] : undefined;
    if (verdict !== "ok") throw new Error("The backup failed its integrity check.");
  } finally {
    database.close();
  }
};

const swapDatabase = Effect.fn("applyPendingRestore.swap")(function* (
  dbPath: string,
  backupPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.try({
    try: () => assertIntact(backupPath),
    catch: (cause) => new BackupIntegrityError({ cause }),
  });
  const stagedPath = `${dbPath}.restoring`;
  yield* Effect.gen(function* () {
    yield* fs.copyFile(backupPath, stagedPath);
    // A leftover WAL belongs to the database being replaced and would corrupt the new one.
    yield* fs.remove(`${dbPath}-wal`, { force: true });
    yield* fs.remove(`${dbPath}-shm`, { force: true });
    yield* fs.rename(stagedPath, dbPath);
  }).pipe(Effect.onError(() => fs.remove(stagedPath, { force: true }).pipe(Effect.ignore)));
});

/**
 * Runs before the database is opened. On any failure the current database is left as it was,
 * and the marker is removed so a broken restore is not retried on every start.
 */
export const applyPendingRestore = Effect.fn("applyPendingRestore")(function* (input: {
  readonly dbPath: string;
  readonly backupsDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const markerPath = restoreMarkerPath(path, input.dbPath);
  if (!(yield* fs.exists(markerPath))) return;
  yield* Effect.gen(function* () {
    const marker = yield* fs.readFileString(markerPath).pipe(Effect.flatMap(decodeRestoreMarker));
    if (!RESTORABLE_BACKUP_PATTERN.test(marker.fileName)) {
      return yield* new InvalidRestoreMarkerError();
    }
    yield* swapDatabase(input.dbPath, path.join(input.backupsDir, marker.fileName));
    yield* Effect.logInfo("Restored the state database from a backup.", {
      fileName: marker.fileName,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not restore the state database; keeping the current one.", {
        cause,
      }),
    ),
    Effect.ensuring(fs.remove(markerPath, { force: true }).pipe(Effect.ignore)),
  );
});
