import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as Library from "./Library.ts";

describe("libraryCategory", () => {
  it.each([
    [{ workspace: "present", kinds: ["html"] }, "deck"],
    [{ workspace: null, kinds: ["video", "html"] }, "video"],
    [{ workspace: "write", kinds: ["html"] }, "writing"],
    [{ workspace: null, kinds: ["text"] }, "writing"],
    [{ workspace: null, kinds: ["html"] }, "design"],
    [{ workspace: null, kinds: ["other"] }, "other"],
  ] as const)("reads %j as %s", (input, category) => {
    expect(Library.libraryCategory(input)).toBe(category);
  });
});

it("links each set to the newest chat that names its folder exactly", () => {
  const links = Library.matchSetThreads(
    [
      { threadId: "old", updatedAt: "2026-11-01", text: ".gradespace/studio/deck/a.html" },
      { threadId: "new", updatedAt: "2026-11-02", text: 'cat > .gradespace/studio/deck/b.html"' },
      { threadId: "other", updatedAt: "2026-11-03", text: ".gradespace/studio/deck-two/a.html" },
    ],
    ["deck", "missing"],
  );
  expect([...links]).toEqual([["deck", "new"]]);
});

it.effect("lists, deletes, restores and empties Studio sets and applications", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-08T12:00:00.000Z"));
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-library-" });
    const project = path.join(home, "project");
    const set = path.join(project, ".gradespace", "studio", "2026-11-08-deck");
    yield* fs.makeDirectory(set, { recursive: true });
    yield* fs.writeFileString(
      path.join(set, "studio.json"),
      JSON.stringify({
        title: "Sunday deck",
        picked: "B",
        variants: [{ file: "a.html" }, { file: "b.html" }],
      }),
    );
    yield* fs.writeFileString(path.join(set, "a.html"), "<h1>A</h1>");
    const career = path.join(home, ".gradespace", "career");
    yield* fs.makeDirectory(path.join(career, "applications", "job-1"), { recursive: true });
    yield* fs.writeFileString(
      path.join(career, "applications", "job-1", "statement.md"),
      "I led it.",
    );
    yield* fs.writeFileString(
      path.join(career, "applications.json"),
      JSON.stringify({
        applications: [
          { id: "job-1", title: "Analyst", employer: "ONS", status: "ready" },
          { id: "job-2", title: "Found only", employer: "X", status: "match" },
        ],
      }),
    );

    const index = Layer.succeed(
      Library.LibraryIndex,
      Library.LibraryIndex.of({
        projects: Effect.succeed([{ id: "p1", title: "Project", workspaceRoot: project }]),
        studioMentions: Effect.succeed([
          {
            threadId: "t1",
            updatedAt: "2026-11-08",
            text: ".gradespace/studio/2026-11-08-deck/a.html",
          },
        ]),
        threads: () => Effect.succeed([{ id: "t1", title: "Make a deck", workspace: "present" }]),
        scratchRoot: Effect.succeedNone,
      }),
    );
    const run = <A, E>(use: (library: Library.Library["Service"]) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        return yield* use(yield* Library.Library);
      }).pipe(
        Effect.provide(Library.layer.pipe(Layer.provide(index))),
        Effect.provideService(HostProcess.HomeDirectory, home),
      );

    const listed = yield* run((library) => library.list);
    expect(
      listed.items.map((item) => [
        item.id,
        item.category,
        item.title,
        item.threadTitle,
        item.setPath,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [
          `studio:${set}`,
          "deck",
          "Sunday deck",
          "Make a deck",
          ".gradespace/studio/2026-11-08-deck",
        ],
        [`career:job-1`, "application", "Analyst · ONS", null, null],
      ]),
    );
    expect(listed.items).toHaveLength(2);
    expect(listed.items.find((item) => item.source === "studio")?.sizeBytes).toBeGreaterThan(0);

    const deleted = yield* run((library) =>
      library.remove({ ids: [`studio:${set}`, "career:job-1"] }),
    );
    expect(deleted.items).toEqual([]);
    expect(deleted.trash.map((item) => item.title).sort()).toEqual([
      "Analyst · ONS",
      "Sunday deck",
    ]);
    expect(yield* fs.exists(set)).toBe(false);
    expect(
      JSON.parse(yield* fs.readFileString(path.join(career, "applications.json"))).applications,
    ).toEqual([{ id: "job-2", title: "Found only", employer: "X", status: "match" }]);

    // A new folder in the old place blocks a restore rather than being overwritten.
    yield* fs.makeDirectory(set, { recursive: true });
    const deckTrash = deleted.trash.find((item) => item.title === "Sunday deck")?.id ?? "";
    const conflict = yield* run((library) => library.restore({ ids: [deckTrash] })).pipe(
      Effect.flip,
    );
    expect(conflict.reason).toBe("restoreConflict");
    yield* fs.remove(set, { recursive: true });

    const restored = yield* run((library) =>
      library.restore({ ids: deleted.trash.map((item) => item.id) }),
    );
    expect(restored.items).toHaveLength(2);
    expect(restored.trash).toEqual([]);
    expect(yield* fs.readFileString(path.join(set, "a.html"))).toBe("<h1>A</h1>");
    expect(
      JSON.parse(yield* fs.readFileString(path.join(career, "applications.json"))).applications.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["job-2", "job-1"]);

    const unknown = yield* run((library) => library.remove({ ids: ["studio:/nowhere"] })).pipe(
      Effect.flip,
    );
    expect(unknown.reason).toBe("unknownItem");

    // Items older than 30 days leave Recently deleted on their own; emptying clears the rest.
    const again = yield* run((library) => library.remove({ ids: [`studio:${set}`] }));
    const trashFolder = path.join(home, ".gradespace", "library-trash", again.trash[0]?.id ?? "");
    const meta = JSON.parse(yield* fs.readFileString(path.join(trashFolder, "meta.json")));
    yield* fs.writeFileString(
      path.join(trashFolder, "meta.json"),
      JSON.stringify({ ...meta, deletedAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect((yield* run((library) => library.list)).trash).toEqual([]);
    yield* run((library) => library.remove({ ids: ["career:job-1"] }));
    const emptied = yield* run((library) => library.emptyTrash);
    expect(emptied.trash).toEqual([]);
    expect(yield* fs.exists(path.join(career, "applications", "job-1"))).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
