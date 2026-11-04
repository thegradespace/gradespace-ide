import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { renderCodexInlineDirectivesAsMarkdown } from "@t3tools/shared/codexMarkdownDirectives";
import { extractMarkdownLinkHrefs } from "@t3tools/shared/markdownLinks";
import { extractBareFilePaths } from "@t3tools/shared/markdownBareFilePaths";
import {
  fileBasename,
  isHostPath,
  resolveWorkspaceFilePath,
  workspaceRelativeFilePath,
} from "@t3tools/shared/path";

import { resolveMarkdownFileLinkMeta } from "../../markdown-links";

export type ThreadMadeFileChange = "created" | "edited" | "deleted";

export interface ThreadMadeFile {
  /** Absolute, or `~/` for home paths; relative agent paths are resolved against the thread cwd. */
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  /** What the agent did last; null when the provider did not say (Claude reports no operation). */
  readonly change: ThreadMadeFileChange | null;
  readonly changedAt: string;
}

export interface ThreadMadeFiles {
  /** Files the agent wrote or edited, newest first. */
  readonly written: ReadonlyArray<ThreadMadeFile>;
  /** Files named in replies that no tool call wrote, newest first. */
  readonly mentioned: ReadonlyArray<ThreadMadeFile>;
}

const WRITING_STATUSES = new Set(["pending", "running", "waiting", "completed"]);
// The Claude adapter names a file change `<Tool> result` when the tool input carried no path.
const FALLBACK_FILE_NAME = /^[A-Za-z]+ result$/u;
const HOME_FOLDER = /^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)(?=[\\/]|$)/u;

function normalizePosixPath(path: string): string {
  if (path.includes("\\") || !path.startsWith("/")) return path;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function resolveHostPath(path: string, cwd: string | null): string {
  const resolved = cwd ? resolveWorkspaceFilePath(path, cwd) : path;
  return normalizePosixPath(resolved);
}

function changeFromOperation(operation: string): ThreadMadeFileChange {
  switch (operation.toLowerCase()) {
    case "add":
    case "create":
    case "created":
      return "created";
    case "delete":
    case "deleted":
    case "remove":
      return "deleted";
    default:
      return "edited";
  }
}

/** The folder as the list shows it: relative to the project, `~/` under home, else absolute. */
function formatMadeFileFolder(path: string, cwd: string | null): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const folder = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  const relativeFolder = workspaceRelativeFilePath(folder, cwd);
  if (relativeFolder !== null) return relativeFolder === "." ? "" : relativeFolder;
  if (path.startsWith("~/")) return folder.length > 1 ? folder : "~";
  const home = HOME_FOLDER.exec(folder);
  if (home !== null) return `~${folder.slice(home[0].length)}`;
  return folder.length === 0 ? separator : folder;
}

interface Accumulated {
  order: number;
  change: ThreadMadeFileChange | null;
  everCreated: boolean;
  changedAt: string;
}

function toMadeFile(path: string, entry: Accumulated, cwd: string | null): ThreadMadeFile {
  const change =
    entry.change === "deleted" ? "deleted" : entry.everCreated ? "created" : entry.change;
  return {
    path,
    name: fileBasename(path),
    folder: formatMadeFileFolder(path, cwd),
    change,
    changedAt: entry.changedAt,
  };
}

function newestFirst(files: Map<string, Accumulated>, cwd: string | null): ThreadMadeFile[] {
  return [...files.entries()]
    .toSorted(([, left], [, right]) => right.order - left.order)
    .map(([path, entry]) => toMadeFile(path, entry, cwd));
}

function mentionedPaths(text: string, cwd: string | null): string[] {
  const hrefs = [
    ...extractMarkdownLinkHrefs(renderCodexInlineDirectivesAsMarkdown(text)),
    ...extractBareFilePaths(text),
  ];
  const paths: string[] = [];
  for (const href of hrefs) {
    const meta = resolveMarkdownFileLinkMeta(href, cwd ?? undefined);
    if (meta === null || !meta.basename.includes(".")) continue;
    if (!isHostPath(meta.filePath) && cwd === null) continue;
    paths.push(resolveHostPath(meta.filePath, cwd));
  }
  return paths;
}

/**
 * Every file the agent wrote or edited in the loaded part of a thread, from the file changes its
 * tools reported, plus files its replies point to that no tool reported. Rows arrive oldest first.
 */
export function collectThreadMadeFiles(
  rows: ReadonlyArray<Pick<OrchestrationV2ProjectedTurnItem, "item" | "visibility">>,
  cwd: string | null,
): ThreadMadeFiles {
  const written = new Map<string, Accumulated>();
  const mentioned = new Map<string, Accumulated>();
  let order = 0;

  for (const { item, visibility } of rows) {
    if (visibility === "inherited") continue;
    order += 1;
    const changedAt = DateTime.formatIso(item.completedAt ?? item.updatedAt);
    if (item.type === "file_change") {
      if (!WRITING_STATUSES.has(item.status)) continue;
      const changes =
        item.changes !== undefined && item.changes.length > 0
          ? item.changes.map((change) => ({
              path: change.path,
              change: changeFromOperation(change.operation),
            }))
          : FALLBACK_FILE_NAME.test(item.fileName)
            ? []
            : [{ path: item.fileName, change: null }];
      // One patch lists its files in a stable order; the first listed stays on top.
      for (const { path, change } of changes.toReversed()) {
        order += 1;
        const resolved = resolveHostPath(path, cwd);
        const previous = written.get(resolved);
        written.set(resolved, {
          order,
          change,
          everCreated: change === "created" || (previous?.everCreated ?? false),
          changedAt,
        });
      }
    } else if (item.type === "assistant_message" && item.text.includes("/")) {
      for (const path of mentionedPaths(item.text, cwd)) {
        mentioned.set(path, { order, change: null, everCreated: false, changedAt });
      }
    }
  }

  for (const path of written.keys()) mentioned.delete(path);
  return { written: newestFirst(written, cwd), mentioned: newestFirst(mentioned, cwd) };
}
