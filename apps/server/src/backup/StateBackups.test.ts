// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import { TestClock } from "effect/testing";

import * as ServerConfig from "../config.ts";
import { applyPendingRestore, backupsDirectory, restoreMarkerPath } from "./pendingRestore.ts";
import * as StateBackups from "./StateBackups.ts";

const layerConfig = Layer.provideMerge(
  ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-backups-" }),
  NodeServices.layer,
);
const layerService = StateBackups.layer.pipe(Layer.provideMerge(layerConfig));

const writeDatabase = (filePath: string, value: string) => {
  const database = new NodeSqlite.DatabaseSync(filePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS notes (value TEXT)");
  database.prepare("INSERT INTO notes (value) VALUES (?)").run(value);
  database.close();
};

const readValues = (filePath: string) => {
  const database = new NodeSqlite.DatabaseSync(filePath, { readOnly: true });
  try {
    return database
      .prepare("SELECT value FROM notes")
      .all()
      .map((row) => row.value);
  } finally {
    database.close();
  }
};

const setup = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = backupsDirectory(path, config.baseDir);
  yield* fs.makeDirectory(directory, { recursive: true });
  return { config, fs, path, directory };
});

it.effect("keeps the 7 newest dated backups and never touches other files", () =>
  Effect.gen(function* () {
    const { config, fs, path, directory } = yield* setup;
    writeDatabase(config.dbPath, "current");
    for (let day = 1; day <= 9; day++) {
      yield* fs.writeFileString(path.join(directory, `statev2-2026-01-0${day}.sqlite`), "old");
    }
    yield* fs.writeFileString(path.join(directory, "statev2-before-final-copy.sqlite"), "hand");
    yield* fs.writeFileString(path.join(directory, "notes.txt"), "hand");

    yield* TestClock.setTime(Date.parse("2026-03-10T12:00:00.000Z"));
    const backups = yield* StateBackups.StateBackups;
    yield* backups.create;

    const names = (yield* fs.readDirectory(directory)).toSorted();
    const today = StateBackups.datedBackupFileName(yield* Clock.currentTimeMillis);
    assert.deepEqual(
      names.filter((name) => /^statev2-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)),
      [4, 5, 6, 7, 8, 9].map((day) => `statev2-2026-01-0${day}.sqlite`).concat(today),
    );
    assert.include(names, "statev2-before-final-copy.sqlite");
    assert.include(names, "notes.txt");
    assert.deepEqual(readValues(path.join(directory, today)), ["current"]);
  }).pipe(Effect.provide(layerService)),
);

it.effect("backs up once per local date and overwrites today's file on demand", () =>
  Effect.gen(function* () {
    const { config, fs, path, directory } = yield* setup;
    writeDatabase(config.dbPath, "first");
    const backups = yield* StateBackups.StateBackups;
    yield* TestClock.setTime(Date.parse("2026-03-10T12:00:00.000Z"));
    const day1 = StateBackups.datedBackupFileName(yield* Clock.currentTimeMillis);

    yield* backups.ensureTodayBackup;
    assert.deepEqual(readValues(path.join(directory, day1)), ["first"]);

    writeDatabase(config.dbPath, "second");
    yield* backups.ensureTodayBackup;
    assert.deepEqual(readValues(path.join(directory, day1)), ["first"]);

    yield* backups.create;
    assert.deepEqual(readValues(path.join(directory, day1)), ["first", "second"]);

    yield* TestClock.setTime(Date.parse("2026-03-12T12:00:00.000Z"));
    yield* backups.ensureTodayBackup;
    const day2 = StateBackups.datedBackupFileName(yield* Clock.currentTimeMillis);
    assert.notEqual(day1, day2);
    assert.isTrue(yield* fs.exists(path.join(directory, day2)));
    assert.isFalse((yield* fs.readDirectory(directory)).some((name) => name.endsWith(".tmp")));
  }).pipe(Effect.provide(layerService)),
);

it.effect("checks shortly after startup, then every hour", () =>
  Effect.gen(function* () {
    const checks = yield* Queue.unbounded<void>();
    yield* StateBackups.dailyBackupSchedule(Queue.offer(checks, undefined)).pipe(Effect.forkScoped);
    yield* TestClock.adjust("59 seconds");
    assert.deepEqual(yield* Queue.clear(checks), []);
    yield* TestClock.adjust("1 second");
    yield* Queue.take(checks);
    yield* TestClock.adjust("1 hour");
    yield* Queue.take(checks);
    yield* TestClock.adjust("1 hour");
    yield* Queue.take(checks);
  }).pipe(Effect.scoped),
);

it.effect("records a failed backup, keeps serving, and clears the error on success", () =>
  Effect.gen(function* () {
    const { config, path } = yield* setup;
    const backups = yield* StateBackups.StateBackups;
    yield* backups.ensureTodayBackup;
    const failedStatus = yield* backups.status;
    assert.isNotNull(failedStatus.lastError);
    assert.isNull(failedStatus.lastBackupAt);

    writeDatabase(path.join(config.dbPath), "now");
    yield* backups.ensureTodayBackup;
    const recovered = yield* backups.status;
    assert.isNull(recovered.lastError);
    assert.isNotNull(recovered.lastBackupAt);
  }).pipe(Effect.provide(layerService)),
);

it.effect("rejects names that are not listed backups and queues a listed one", () =>
  Effect.gen(function* () {
    const { config, fs, path, directory } = yield* setup;
    writeDatabase(config.dbPath, "current");
    yield* fs.writeFileString(path.join(directory, "statev2-2026-01-01.sqlite"), "x");
    const backups = yield* StateBackups.StateBackups;

    for (const name of [
      "../userdata/statev2.sqlite",
      "..%2Fstatev2.sqlite",
      "/etc/passwd",
      "statev2-2026-01-02.sqlite",
    ]) {
      const error = yield* Effect.flip(backups.restore(name));
      assert.equal(error.reason, "unknownBackup");
    }
    assert.isFalse(yield* fs.exists(restoreMarkerPath(path, config.dbPath)));
    assert.isFalse(
      (yield* fs.readDirectory(directory)).some((name) =>
        name.startsWith("statev2-before-restore"),
      ),
    );

    const queued = yield* backups.restore("statev2-2026-01-01.sqlite");
    assert.equal(queued.pendingRestore, "statev2-2026-01-01.sqlite");
    const safety = queued.backups.filter((entry) =>
      entry.fileName.startsWith("statev2-before-restore-"),
    );
    assert.equal(safety.length, 1);
    assert.deepEqual(readValues(path.join(directory, safety[0]!.fileName)), ["current"]);

    const cancelled = yield* backups.cancelRestore;
    assert.isNull(cancelled.pendingRestore);
  }).pipe(Effect.provide(layerService)),
);

const stageRestore = (backupContents: (backupPath: string) => void) =>
  Effect.gen(function* () {
    const { config, fs, path, directory } = yield* setup;
    writeDatabase(config.dbPath, "current");
    yield* fs.writeFileString(`${config.dbPath}-wal`, "stale wal");
    backupContents(path.join(directory, "statev2-2026-01-01.sqlite"));
    const markerPath = restoreMarkerPath(path, config.dbPath);
    yield* fs.writeFileString(
      markerPath,
      JSON.stringify({
        fileName: "statev2-2026-01-01.sqlite",
        requestedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    const before = NodeFS.readFileSync(config.dbPath);
    yield* applyPendingRestore({ dbPath: config.dbPath, backupsDir: directory });
    return { config, fs, markerPath, before };
  });

it.effect("swaps in a valid backup at startup and removes the marker", () =>
  Effect.gen(function* () {
    const { config, fs, markerPath } = yield* stageRestore((backupPath) =>
      writeDatabase(backupPath, "from backup"),
    );
    assert.isFalse(yield* fs.exists(markerPath));
    assert.isFalse(yield* fs.exists(`${config.dbPath}-wal`));
    assert.deepEqual(readValues(config.dbPath), ["from backup"]);
    assert.isFalse(yield* fs.exists(`${config.dbPath}.restoring`));
  }).pipe(Effect.provide(layerConfig)),
);

it.effect("keeps the current database when the backup is invalid", () =>
  Effect.gen(function* () {
    const { config, fs, markerPath, before } = yield* stageRestore((backupPath) =>
      NodeFS.writeFileSync(backupPath, "this is not a database"),
    );
    assert.isTrue(NodeFS.readFileSync(config.dbPath).equals(before));
    assert.isFalse(yield* fs.exists(markerPath));
    assert.isFalse(yield* fs.exists(`${config.dbPath}.restoring`));
  }).pipe(Effect.provide(layerConfig)),
);
