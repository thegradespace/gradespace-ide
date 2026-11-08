import {
  type LibraryCategory,
  LibraryError,
  type LibraryIdsInput,
  type LibraryItem,
  type LibraryReport,
  type LibraryTrashItem,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { ManagedProjectFolders } from "../project/ManagedProjectFolders.ts";

const STUDIO_ROOT = ".gradespace/studio";
const TRASH_DAYS = 30;

const StudioManifestFile = Schema.fromJsonString(
  Schema.Struct({
    title: Schema.String,
    picked: Schema.optional(Schema.NullOr(Schema.String)),
    variants: Schema.Array(Schema.Struct({ file: Schema.String })),
  }),
);
const decodeManifest = Schema.decodeUnknownOption(StudioManifestFile);

const TrashMeta = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: Schema.Literals(["deck", "design", "writing", "video", "application", "other"]),
  deletedAt: Schema.String,
  sizeBytes: Schema.Number,
  originalPath: Schema.String,
  source: Schema.Literals(["studio", "career"]),
  /** The applications.json entry an application was removed from, to put back on restore. */
  careerEntry: Schema.optional(Schema.Unknown),
});
type TrashMeta = typeof TrashMeta.Type;
const decodeTrashMeta = Schema.decodeUnknownOption(Schema.fromJsonString(TrashMeta));

/** `html`, `video`, `image`, `pdf`, `text` or `other`, from a Studio option's file name. */
function fileKind(file: string): string {
  if (/\.(mp4|m4v|webm|mov)$/iu.test(file)) return "video";
  if (/\.html?$/iu.test(file)) return "html";
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/iu.test(file)) return "image";
  if (/\.pdf$/iu.test(file)) return "pdf";
  if (/\.(md|mdx|markdown|txt)$/iu.test(file)) return "text";
  return "other";
}

/** The chat's workspace says what it made; the files decide when there's no chat. */
export function libraryCategory(input: {
  readonly workspace: string | null;
  readonly kinds: ReadonlyArray<string>;
}): LibraryCategory {
  if (input.kinds.includes("video")) return "video";
  if (input.workspace === "present") return "deck";
  if (input.workspace === "write" || input.workspace === "mail") return "writing";
  if (input.workspace === "studio") return "design";
  if (input.kinds.length > 0 && input.kinds.every((kind) => kind === "text")) return "writing";
  if (input.kinds.some((kind) => kind === "html" || kind === "image" || kind === "pdf")) {
    return "design";
  }
  return "other";
}

/**
 * The newest chat whose steps name each Studio set folder. Agents write sets with file edits
 * and shell commands alike, so any recorded step that names the folder counts.
 */
export function matchSetThreads(
  mentions: ReadonlyArray<{ threadId: string; updatedAt: string; text: string }>,
  folderNames: ReadonlyArray<string>,
): ReadonlyMap<string, string> {
  const best = new Map<string, { threadId: string; updatedAt: string }>();
  for (const name of folderNames) {
    const needle = `${STUDIO_ROOT}/${name}`;
    for (const mention of mentions) {
      const at = mention.text.indexOf(needle);
      if (at < 0) continue;
      const next = mention.text.charAt(at + needle.length);
      // Not a longer folder name that merely starts with this one.
      if (next !== "" && /[\w-]/u.test(next)) continue;
      const current = best.get(name);
      if (current === undefined || mention.updatedAt > current.updatedAt) {
        best.set(name, { threadId: mention.threadId, updatedAt: mention.updatedAt });
      }
    }
  }
  return new Map([...best].map(([name, { threadId }]) => [name, threadId]));
}

/** Projects and chats Library reads from the server's own database. */
export class LibraryIndex extends Context.Service<
  LibraryIndex,
  {
    readonly projects: Effect.Effect<
      ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>
    >;
    /** Steps that name a Studio folder, cut to the text around the first mention. */
    readonly studioMentions: Effect.Effect<
      ReadonlyArray<{ threadId: string; updatedAt: string; text: string }>
    >;
    readonly threads: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<{ id: string; title: string; workspace: string | null }>>;
    readonly scratchRoot: Effect.Effect<Option.Option<string>>;
  }
>()("t3/library/Library/LibraryIndex") {}

export const layerIndex = Layer.effect(
  LibraryIndex,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const folders = yield* ManagedProjectFolders;
    const quiet = <A, E>(effect: Effect.Effect<ReadonlyArray<A>, E>) =>
      effect.pipe(Effect.orElseSucceed((): ReadonlyArray<A> => []));
    return LibraryIndex.of({
      projects: quiet(
        sql<{ id: string; title: string; workspaceRoot: string }>`
          SELECT project_id AS id, title, workspace_root AS "workspaceRoot"
          FROM projection_projects
          WHERE deleted_at IS NULL
        `,
      ),
      studioMentions: quiet(
        sql<{ threadId: string; updatedAt: string; text: string }>`
          SELECT thread_id AS "threadId", updated_at AS "updatedAt",
            substr(payload_json, instr(payload_json, ${STUDIO_ROOT}), 160) AS text
          FROM orchestration_v2_projection_turn_items
          WHERE instr(payload_json, ${STUDIO_ROOT}) > 0
        `,
      ),
      threads: Effect.fn("LibraryIndex.threads")(function* (ids: ReadonlyArray<string>) {
        if (ids.length === 0) return [];
        return yield* quiet(
          sql<{ id: string; title: string; workspace: string | null }>`
                SELECT thread_id AS id, title, json_extract(payload_json, '$.workspace') AS workspace
                FROM orchestration_v2_projection_threads
                WHERE ${sql.in("thread_id", ids)}
              `,
        );
      }),
      scratchRoot: folders.scratchRoot,
    });
  }),
);

export class Library extends Context.Service<
  Library,
  {
    /** Never fails: unreadable folders are skipped. Also clears trash older than 30 days. */
    readonly list: Effect.Effect<LibraryReport>;
    /** Moves items to Recently deleted; the chats that made them stay. */
    readonly remove: (input: LibraryIdsInput) => Effect.Effect<LibraryReport, LibraryError>;
    readonly restore: (input: LibraryIdsInput) => Effect.Effect<LibraryReport, LibraryError>;
    /** Deletes everything in Recently deleted for good, freeing the space. */
    readonly emptyTrash: Effect.Effect<LibraryReport, LibraryError>;
  }
>()("t3/library/Library") {}

type JsonObject = { [key: string]: unknown };
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const parseObject = (text: string): JsonObject | null => {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
};

const prettyJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const index = yield* LibraryIndex;

  const readText = (file: string) => fs.readFileString(file).pipe(Effect.option);
  const isDirectory = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
  const listDirectory = (directory: string) =>
    fs.readDirectory(directory).pipe(Effect.orElseSucceed((): string[] => []));

  /** Total size and newest change under a folder; Studio sets are shallow. */
  const measure: (
    folder: string,
    depth?: number,
  ) => Effect.Effect<{ size: number; modified: number }> = Effect.fn("Library.measure")(function* (
    folder: string,
    depth = 0,
  ) {
    let size = 0;
    let modified = 0;
    for (const name of yield* listDirectory(folder)) {
      const file = path.join(folder, name);
      const info = yield* fs.stat(file).pipe(Effect.option);
      if (Option.isNone(info)) continue;
      const time = Option.match(info.value.mtime, {
        onNone: () => 0,
        onSome: (date) => date.getTime(),
      });
      if (info.value.type === "Directory" && depth < 4) {
        const inner = yield* measure(file, depth + 1);
        size += inner.size;
        modified = Math.max(modified, inner.modified, time);
      } else {
        size += Number(info.value.size);
        modified = Math.max(modified, time);
      }
    }
    return { size, modified };
  });

  const roots = Effect.gen(function* () {
    const home = yield* HostProcess.HomeDirectory;
    const projects = yield* index.projects;
    const scratch = Option.getOrNull(yield* index.scratchRoot);
    const result: Array<{ root: string; projectId: string; projectTitle: string }> = [];
    const seen = new Set<string>();
    const add = (root: string, projectId: string, projectTitle: string) => {
      const resolved = path.resolve(root);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      result.push({ root: resolved, projectId, projectTitle });
    };
    for (const project of projects) {
      add(project.workspaceRoot, project.id, project.title);
      // Chats without a project each get a folder under the scratch root.
      if (scratch !== null && path.resolve(project.workspaceRoot) === path.resolve(scratch)) {
        for (const child of yield* listDirectory(scratch)) {
          add(path.join(scratch, child), project.id, "No project");
        }
      }
    }
    return { roots: result, home };
  });

  const careerRoot = (home: string) => path.join(home, ".gradespace", "career");
  const trashRoot = (home: string) => path.join(home, ".gradespace", "library-trash");

  const collect = Effect.gen(function* () {
    const { roots: projectRoots, home } = yield* roots;
    const sets: Array<{
      folder: string;
      name: string;
      root: string;
      projectId: string;
      projectTitle: string;
      title: string;
      picked: string | null;
      kinds: string[];
      optionCount: number;
    }> = [];
    for (const { root, projectId, projectTitle } of projectRoots) {
      const studio = path.join(root, STUDIO_ROOT);
      for (const name of yield* listDirectory(studio)) {
        const folder = path.join(studio, name);
        const manifest = Option.flatMap(
          yield* readText(path.join(folder, "studio.json")),
          decodeManifest,
        );
        if (Option.isNone(manifest)) continue;
        sets.push({
          folder,
          name,
          root,
          projectId,
          projectTitle,
          title: manifest.value.title,
          picked: manifest.value.picked ?? null,
          kinds: [...new Set(manifest.value.variants.map((variant) => fileKind(variant.file)))],
          optionCount: manifest.value.variants.length,
        });
      }
    }
    const threadBySet = matchSetThreads(
      yield* index.studioMentions,
      sets.map((set) => set.name),
    );
    const threads = new Map(
      (yield* index.threads([...new Set(threadBySet.values())])).map((thread) => [
        thread.id,
        thread,
      ]),
    );
    const items: LibraryItem[] = [];
    for (const set of sets) {
      const { size, modified } = yield* measure(set.folder);
      const thread = threads.get(threadBySet.get(set.name) ?? "");
      items.push({
        id: `studio:${set.folder}`,
        source: "studio",
        category: libraryCategory({ workspace: thread?.workspace ?? null, kinds: set.kinds }),
        title: set.title,
        path: set.folder,
        projectId: set.projectId,
        projectTitle: set.projectTitle,
        setPath: path.relative(set.root, set.folder),
        optionCount: set.optionCount,
        picked: set.picked,
        kinds: set.kinds,
        updatedAt: DateTime.formatIso(DateTime.makeUnsafe(modified)),
        sizeBytes: size,
        threadId: thread?.id ?? null,
        threadTitle: thread?.title ?? null,
      });
    }

    const applications = Option.flatMap(
      yield* readText(path.join(careerRoot(home), "applications.json")),
      (text) => Option.fromNullishOr(parseObject(text)?.applications),
    );
    const entries =
      Option.isSome(applications) && Array.isArray(applications.value)
        ? applications.value.filter(isObject)
        : [];
    for (const entry of entries) {
      const id = typeof entry.id === "string" ? entry.id : null;
      if (id === null || !/^[\w.-]+$/u.test(id) || id.startsWith(".")) continue;
      if (entry.status === "match" || entry.status === "skipped") continue;
      const folder = path.join(careerRoot(home), "applications", id);
      if (!(yield* isDirectory(folder))) continue;
      const files = yield* listDirectory(folder);
      const { size, modified } = yield* measure(folder);
      items.push({
        id: `career:${id}`,
        source: "career",
        category: "application",
        title: [entry.title, entry.employer].filter((part) => typeof part === "string").join(" · "),
        path: folder,
        projectId: null,
        projectTitle: null,
        setPath: null,
        optionCount: files.length,
        picked: null,
        kinds: [...new Set(files.map(fileKind))],
        updatedAt: DateTime.formatIso(DateTime.makeUnsafe(modified)),
        sizeBytes: size,
        threadId: null,
        threadTitle: null,
      });
    }
    return {
      items: items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      home,
    };
  });

  const readTrash = Effect.fn("Library.readTrash")(function* (home: string) {
    const root = trashRoot(home);
    const entries: Array<{ folder: string; meta: TrashMeta }> = [];
    for (const name of yield* listDirectory(root)) {
      const folder = path.join(root, name);
      const meta = Option.flatMap(yield* readText(path.join(folder, "meta.json")), decodeTrashMeta);
      if (Option.isSome(meta)) entries.push({ folder, meta: meta.value });
    }
    return entries;
  });

  const trashView = (entries: ReadonlyArray<{ folder: string; meta: TrashMeta }>) =>
    entries
      .map(({ folder, meta }): LibraryTrashItem => ({
        id: path.basename(folder),
        title: meta.title,
        category: meta.category,
        deletedAt: meta.deletedAt,
        sizeBytes: meta.sizeBytes,
      }))
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));

  const list = Effect.gen(function* () {
    const { items, home } = yield* collect;
    const now = yield* DateTime.now;
    const cutoff = DateTime.formatIso(DateTime.subtract(now, { days: TRASH_DAYS }));
    const trash = yield* readTrash(home);
    const kept: typeof trash = [];
    for (const entry of trash) {
      if (entry.meta.deletedAt < cutoff) {
        yield* fs.remove(entry.folder, { recursive: true }).pipe(Effect.ignore);
      } else {
        kept.push(entry);
      }
    }
    return { items, trash: trashView(kept) };
  }).pipe(Effect.withSpan("Library.list"));

  /** Rename, or copy then remove when the trash is on another disk. */
  const move = (from: string, to: string) =>
    fs.rename(from, to).pipe(
      Effect.catch(() =>
        fs.copy(from, to).pipe(Effect.andThen(fs.remove(from, { recursive: true }))),
      ),
      Effect.mapError(() => new LibraryError({ reason: "moveFailed" })),
    );

  const editApplications = Effect.fn("Library.editApplications")(
    function* (home: string, edit: (list: unknown[]) => unknown[]) {
      const file = path.join(careerRoot(home), "applications.json");
      const document = Option.flatMap(yield* readText(file), (text) =>
        Option.fromNullishOr(parseObject(text)),
      );
      if (Option.isNone(document)) return;
      const current = Array.isArray(document.value.applications) ? document.value.applications : [];
      document.value.applications = edit(current);
      yield* fs
        .writeFileString(`${file}.tmp`, prettyJson(document.value))
        .pipe(Effect.andThen(fs.rename(`${file}.tmp`, file)));
    },
    Effect.mapError(() => new LibraryError({ reason: "moveFailed" })),
  );

  const remove = Effect.fn("Library.remove")(function* (input: LibraryIdsInput) {
    const { items, home } = yield* collect;
    const chosen = input.ids.map((id) => items.find((item) => item.id === id));
    if (chosen.some((item) => item === undefined)) {
      return yield* new LibraryError({ reason: "unknownItem" });
    }
    const now = DateTime.formatIso(yield* DateTime.now);
    for (const item of chosen) {
      if (item === undefined) continue;
      const slug = path
        .basename(item.path)
        .replace(/[^\w.-]+/gu, "-")
        .slice(0, 60);
      const folder = path.join(trashRoot(home), `${now.replace(/[:.]/gu, "-")}-${slug}`);
      yield* fs
        .makeDirectory(folder, { recursive: true })
        .pipe(Effect.mapError(() => new LibraryError({ reason: "moveFailed" })));
      let careerEntry: unknown;
      if (item.source === "career") {
        const id = item.id.slice("career:".length);
        yield* editApplications(home, (list) =>
          list.filter((entry) => {
            if (isObject(entry) && entry.id === id) {
              careerEntry = entry;
              return false;
            }
            return true;
          }),
        );
      }
      yield* move(item.path, path.join(folder, "content"));
      const meta: TrashMeta = {
        id: item.id,
        title: item.title,
        category: item.category,
        deletedAt: now,
        sizeBytes: item.sizeBytes,
        originalPath: item.path,
        source: item.source,
        ...(careerEntry === undefined ? {} : { careerEntry }),
      };
      yield* fs
        .writeFileString(path.join(folder, "meta.json"), prettyJson(meta))
        .pipe(Effect.mapError(() => new LibraryError({ reason: "moveFailed" })));
    }
    return yield* list;
  });

  const restore = Effect.fn("Library.restore")(function* (input: LibraryIdsInput) {
    const home = yield* HostProcess.HomeDirectory;
    const trash = yield* readTrash(home);
    const chosen = input.ids.map((id) => trash.find((entry) => path.basename(entry.folder) === id));
    if (chosen.some((entry) => entry === undefined)) {
      return yield* new LibraryError({ reason: "unknownItem" });
    }
    for (const entry of chosen) {
      if (entry === undefined) continue;
      const original = path.resolve(entry.meta.originalPath);
      // Only ever put things back where Library takes them from.
      const allowed =
        original.includes(`${path.sep}${STUDIO_ROOT.replace("/", path.sep)}${path.sep}`) ||
        path.dirname(original) === path.join(careerRoot(home), "applications");
      if (!allowed) return yield* new LibraryError({ reason: "unknownItem" });
      if (yield* fs.exists(original).pipe(Effect.orElseSucceed(() => false))) {
        return yield* new LibraryError({ reason: "restoreConflict" });
      }
      yield* fs
        .makeDirectory(path.dirname(original), { recursive: true })
        .pipe(Effect.mapError(() => new LibraryError({ reason: "moveFailed" })));
      yield* move(path.join(entry.folder, "content"), original);
      if (entry.meta.source === "career" && entry.meta.careerEntry !== undefined) {
        const careerEntry = entry.meta.careerEntry;
        yield* editApplications(home, (list) => [...list, careerEntry]);
      }
      yield* fs.remove(entry.folder, { recursive: true }).pipe(Effect.ignore);
    }
    return yield* list;
  });

  const emptyTrash = Effect.gen(function* () {
    const home = yield* HostProcess.HomeDirectory;
    yield* fs.remove(trashRoot(home), { recursive: true }).pipe(
      Effect.catchIf(
        (error) => error._tag === "PlatformError" && error.reason._tag === "NotFound",
        () => Effect.void,
      ),
      Effect.mapError(() => new LibraryError({ reason: "moveFailed" })),
    );
    return yield* list;
  }).pipe(Effect.withSpan("Library.emptyTrash"));

  return Library.of({ list, remove, restore, emptyTrash });
});

export const layer = Layer.effect(Library, make);
