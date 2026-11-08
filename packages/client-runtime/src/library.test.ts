import type { LibraryItem } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { filterLibrary, formatBytes, libraryCounts, libraryReuse } from "./library.ts";

const item = (id: string, fields: Partial<LibraryItem> = {}): LibraryItem => ({
  id,
  source: "studio",
  category: "design",
  title: id,
  path: `/work/.gradespace/studio/${id}`,
  projectId: "p",
  projectTitle: "Project",
  setPath: `.gradespace/studio/${id}`,
  optionCount: 3,
  picked: null,
  kinds: ["html"],
  updatedAt: "2026-11-01T00:00:00.000Z",
  sizeBytes: 100,
  threadId: null,
  threadTitle: null,
  ...fields,
});

it("filters by category and every query word, newest or largest first", () => {
  const items = [
    item("old deck", { category: "deck", updatedAt: "2026-11-01", sizeBytes: 900 }),
    item("new deck", { category: "deck", updatedAt: "2026-11-05", sizeBytes: 10 }),
    item("logo", { threadTitle: "Sunday deck ideas" }),
  ];
  const ids = (sort: "newest" | "largest", category: "all" | "deck", query = "") =>
    filterLibrary(items, { category, query, sort }).map((entry) => entry.id);
  expect(ids("newest", "deck")).toEqual(["new deck", "old deck"]);
  expect(ids("largest", "deck")).toEqual(["old deck", "new deck"]);
  expect(ids("newest", "all", "sunday DECK")).toEqual(["logo"]);
  expect(libraryCounts(items)).toMatchObject({ all: 3, deck: 2, design: 1 });
});

it("formats sizes and starts reuse in the item's workspace", () => {
  expect([formatBytes(512), formatBytes(2048), formatBytes(5.5 * 1024 * 1024)]).toEqual([
    "512 B",
    "2.0 KB",
    "5.5 MB",
  ]);
  expect(libraryReuse(item("deck", { category: "deck", picked: "C" }))).toEqual({
    workspace: "present",
    prompt:
      '$gs-present Use the deck "deck" at /work/.gradespace/studio/deck (option C was picked) as a starting point. ',
  });
});
