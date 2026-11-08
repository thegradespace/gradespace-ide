import type { LibraryCategory, LibraryItem } from "@t3tools/contracts";

import type { WorkspaceId } from "./workspaces.ts";

export const LIBRARY_CATEGORIES: ReadonlyArray<{ id: LibraryCategory; label: string }> = [
  { id: "deck", label: "Decks" },
  { id: "design", label: "Designs" },
  { id: "writing", label: "Writing" },
  { id: "video", label: "Video" },
  { id: "application", label: "Applications" },
  { id: "other", label: "Other" },
];

export const LIBRARY_CATEGORY_NAMES: Readonly<Record<LibraryCategory, string>> = {
  deck: "Deck",
  design: "Design",
  writing: "Writing",
  video: "Video",
  application: "Application",
  other: "File",
};

export type LibrarySort = "newest" | "largest";

export interface LibraryFilter {
  readonly category: LibraryCategory | "all";
  readonly query: string;
  readonly sort: LibrarySort;
}

/** Items matching the category and every word of the query, newest or largest first. */
export function filterLibrary(
  items: ReadonlyArray<LibraryItem>,
  filter: LibraryFilter,
): ReadonlyArray<LibraryItem> {
  const words = filter.query.toLowerCase().split(/\s+/u).filter(Boolean);
  const matches = items.filter((item) => {
    if (filter.category !== "all" && item.category !== filter.category) return false;
    const haystack = [item.title, item.projectTitle, item.threadTitle].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  return [...matches].sort((left, right) =>
    filter.sort === "largest"
      ? right.sizeBytes - left.sizeBytes
      : right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function libraryCounts(
  items: ReadonlyArray<LibraryItem>,
): Readonly<Record<LibraryCategory | "all", number>> {
  const counts = {
    all: items.length,
    deck: 0,
    design: 0,
    writing: 0,
    video: 0,
    application: 0,
    other: 0,
  };
  for (const item of items) counts[item.category] += 1;
  return counts;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const REUSE: Readonly<Record<LibraryCategory, { workspace: WorkspaceId; skill: string | null }>> = {
  deck: { workspace: "present", skill: "gs-present" },
  design: { workspace: "studio", skill: "gs-design" },
  writing: { workspace: "write", skill: "gs-write" },
  video: { workspace: "studio", skill: "gs-video" },
  application: { workspace: "career", skill: "gs-jobs" },
  other: { workspace: "code", skill: null },
};

/** The workspace and opening text for a new chat that starts from an item. */
export function libraryReuse(item: LibraryItem): { workspace: WorkspaceId; prompt: string } {
  const { workspace, skill } = REUSE[item.category];
  const what = LIBRARY_CATEGORY_NAMES[item.category].toLowerCase();
  const picked = item.picked ? ` (option ${item.picked} was picked)` : "";
  const request = `Use the ${what} "${item.title}" at ${item.path}${picked} as a starting point. `;
  return { workspace, prompt: skill ? `$${skill} ${request}` : request };
}
