import * as NodeWorkerThreads from "node:worker_threads";

import {
  BackupError,
  DATED_BACKUP_FILE_PATTERN,
  type BackupEntry,
  type BackupStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import { forkParked } from "../serverActivation.ts";
import {
  RESTORABLE_BACKUP_PATTERN,
  backupsDirectory,
  decodeRestoreMarker,
  encodeRestoreMarker,
  restoreMarkerPath,
} from "./pendingRestore.ts";

const KEPT_DATED_BACKUPS = 7;
const FIRST_CHECK_DELAY = "1 minute";
const CHECK_INTERVAL = "1 hour";

const pad = (value: number) => String(value).padStart(2, "0");

const isoTimestamp = (epochMs: number) => DateTime.formatIso(DateTime.makeUnsafe(epochMs));

/** Named for the local calendar day, so a backup is due again after local midnight. */
export const datedBackupFileName = (epochMs: number) => {
  const { year, month, day } = DateTime.toParts(
    DateTime.makeZonedUnsafe(epochMs, { timeZone: DateTime.zoneMakeLocal() }),
  );
  return `statev2-${year}-${pad(month)}-${pad(day)}.sqlite`;
};

const safetyBackupFileName = (epochMs: number) =>
  `statev2-before-restore-${isoTimestamp(epochMs).replace(/[:.]/g, "-")}.sqlite`;

class SnapshotError extends Schema.TaggedError<SnapshotError>()("SnapshotError", {
  cause: Schema.Defect(),
}) {}

/** Names sort by date, so the newest are the last ones. */
const datedBackupsToDelete = (fileNames: ReadonlyArray<string>) =>
  fileNames
    .filter((fileName) => DATED_BACKUP_FILE_PATTERN.test(fileName))
    .toSorted()
    .slice(0, -KEPT_DATED_BACKUPS);

// A page-level copy keeps rowids, which the message search index is keyed by; VACUUM INTO does not.
// It runs in a worker as one step so the event loop stays free and the copy never restarts mid-write.
const snapshotWorkerSource = `
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync, backup } = require("node:sqlite");
const db = new DatabaseSync(workerData.source, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");
backup(db, workerData.destination, { rate: 1 << 30 }).then(
  () => { db.close(); parentPort.postMessage({ ok: true }); },
  (error) => { parentPort.postMessage({ message: String(error && error.message ? error.message : error) }); },
);
`;

const snapshotDatabase = (source: string, destination: string) =>
  Effect.callback<void, SnapshotError>((resume) => {
    const worker = new NodeWorkerThreads.Worker(snapshotWorkerSource, {
      eval: true,
      workerData: { source, destination },
    });
    worker.once("message", (message: { readonly message?: string }) => {
      resume(
        message.message === undefined
          ? Effect.void
          : Effect.fail(new SnapshotError({ cause: message.message })),
      );
    });
    worker.once("error", (cause) => resume(Effect.fail(new SnapshotError({ cause }))));
    worker.once("exit", (code) => {
      if (code !== 0) resume(Effect.fail(new SnapshotError({ cause: `exit code ${code}` })));
    });
    return Effect.promise(() => worker.terminate());
  });

/** One check shortly after startup, then hourly: cheap, and it catches the date rolling over. */
export const dailyBackupSchedule = (check: Effect.Effect<void>) =>
  Effect.sleep(FIRST_CHECK_DELAY).pipe(
    Effect.andThen(check.pipe(Effect.repeat(Schedule.spaced(CHECK_INTERVAL)))),
  );

const firstLine = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).split(/\r?\n/)[0]!.slice(0, 200);

const describeFailure = (error: BackupError) =>
  error.cause === undefined ? error.message : `${error.message} ${firstLine(error.cause)}`;

export class StateBackups extends Context.Service<
  StateBackups,
  {
    readonly status: Effect.Effect<BackupStatus, BackupError>;
    /** Writes today's backup, replacing one already made today, then drops the oldest dated ones. */
    readonly create: Effect.Effect<BackupStatus, BackupError>;
    /** Saves the current database first, then queues the restore for the next start. */
    readonly restore: (fileName: string) => Effect.Effect<BackupStatus, BackupError>;
    readonly cancelRestore: Effect.Effect<BackupStatus, BackupError>;
    /** Backs up when today's file is missing. The schedule calls this; failures are logged, not raised. */
    readonly ensureTodayBackup: Effect.Effect<void>;
  }
>()("t3/backup/StateBackups") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const directory = backupsDirectory(path, config.baseDir);
  const markerPath = restoreMarkerPath(path, config.dbPath);
  const lock = yield* Semaphore.make(1);
  const lastError = yield* Ref.make<string | null>(null);

  const failed = (reason: BackupError["reason"]) => (cause: unknown) =>
    new BackupError({ reason, cause });

  const listFiles = fs.readDirectory(directory).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed([] as Array<string>),
    ),
  );

  const readEntries = Effect.gen(function* () {
    const entries = yield* Effect.forEach(
      (yield* listFiles).filter((fileName) => RESTORABLE_BACKUP_PATTERN.test(fileName)),
      (fileName) =>
        fs.stat(path.join(directory, fileName)).pipe(
          Effect.map((info): BackupEntry => ({
            fileName,
            createdAt: isoTimestamp(
              Option.match(info.mtime, { onNone: () => 0, onSome: (mtime) => mtime.getTime() }),
            ),
            sizeBytes: Number(info.size),
          })),
        ),
    );
    return entries.toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.fileName.localeCompare(left.fileName),
    );
  });

  const readPendingRestore = fs.readFileString(markerPath).pipe(
    Effect.flatMap(decodeRestoreMarker),
    Effect.map((marker) => marker.fileName),
    Effect.orElseSucceed(() => null),
  );

  const readStatus = Effect.gen(function* () {
    const backups = yield* readEntries;
    return {
      directory,
      backups,
      lastBackupAt:
        backups.find((entry) => DATED_BACKUP_FILE_PATTERN.test(entry.fileName))?.createdAt ?? null,
      lastError: yield* Ref.get(lastError),
      pendingRestore: yield* readPendingRestore,
    } satisfies BackupStatus;
  }).pipe(Effect.mapError(failed("backupFailed")));

  // Publishing by rename means a crash never leaves a partial file under a real backup name.
  const writeBackup = Effect.fn("StateBackups.writeBackup")(function* (fileName: string) {
    const temporaryPath = path.join(directory, `.${fileName}.${process.pid}.tmp`);
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* snapshotDatabase(config.dbPath, temporaryPath);
      yield* fs.rename(temporaryPath, path.join(directory, fileName));
    }).pipe(
      Effect.onError(() => fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
      Effect.mapError(failed("backupFailed")),
    );
  });

  const rotate = Effect.gen(function* () {
    for (const fileName of datedBackupsToDelete(yield* listFiles)) {
      yield* fs.remove(path.join(directory, fileName), { force: true });
    }
  });

  const create = Effect.fn("StateBackups.create")(function* () {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* writeBackup(datedBackupFileName(yield* Clock.currentTimeMillis));
        // The new backup is safe; failing to trim old ones must not read as a failed backup.
        yield* rotate.pipe(
          Effect.catch((cause) => Effect.logWarning("Could not remove old backups.", { cause })),
        );
        yield* Ref.set(lastError, null);
      }).pipe(
        Effect.tapError((error) => Ref.set(lastError, describeFailure(error))),
        Effect.tapError((error) => Effect.logWarning("State backup failed.", { error })),
      ),
    );
    return yield* readStatus;
  });

  const restore = Effect.fn("StateBackups.restore")(function* (fileName: string) {
    // Only names found in the folder are accepted, so a path can never be smuggled in.
    if (
      !(yield* readEntries.pipe(Effect.mapError(failed("restoreFailed")))).some(
        (entry) => entry.fileName === fileName,
      )
    ) {
      return yield* new BackupError({ reason: "unknownBackup" });
    }
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* writeBackup(safetyBackupFileName(yield* Clock.currentTimeMillis));
        const stagedPath = `${markerPath}.tmp`;
        yield* fs.writeFileString(
          stagedPath,
          yield* encodeRestoreMarker({
            fileName,
            requestedAt: isoTimestamp(yield* Clock.currentTimeMillis),
          }),
        );
        yield* fs.rename(stagedPath, markerPath);
      }).pipe(Effect.mapError(failed("restoreFailed"))),
    );
    return yield* readStatus;
  });

  const cancelRestore = Effect.fn("StateBackups.cancelRestore")(function* () {
    yield* fs.remove(markerPath, { force: true }).pipe(Effect.mapError(failed("restoreFailed")));
    return yield* readStatus;
  });

  const ensureTodayBackup = Effect.gen(function* () {
    const today = datedBackupFileName(yield* Clock.currentTimeMillis);
    if (yield* fs.exists(path.join(directory, today))) return;
    yield* create();
  }).pipe(
    Effect.ignore,
    Effect.catchCause((cause) => Effect.logWarning("State backup check failed.", { cause })),
  );

  yield* forkParked(dailyBackupSchedule(ensureTodayBackup));

  return StateBackups.of({
    status: readStatus,
    create: create(),
    restore,
    cancelRestore: cancelRestore(),
    ensureTodayBackup,
  });
});

export const layer = Layer.effect(StateBackups, make);
