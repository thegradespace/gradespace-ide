import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

import { collectThreadMadeFiles } from "../chat/threadMadeFiles.logic";
import { STUDIO_ROOT } from "./studioManifest";

export interface StudioTurnSet {
  /** Workspace-relative, as Studio lists it. */
  readonly setPath: string;
  readonly name: string;
  /** Changes when the turn touched the set again, so a card rereads its manifest. */
  readonly revision: string;
}

const SET_FOLDER = new RegExp(`^${STUDIO_ROOT.replaceAll(".", "\\.")}/([^/]+)(?:/|$)`, "u");

/**
 * The Studio sets each turn wrote, keyed by the turn's last assistant message so the card sits
 * under the reply. Sets the turn only deleted from are left out.
 */
export function collectStudioTurnSets(
  rows: ReadonlyArray<Pick<OrchestrationV2ProjectedTurnItem, "item" | "visibility">>,
  cwd: string | null,
): ReadonlyMap<string, ReadonlyArray<StudioTurnSet>> {
  const fileRowsByRun = new Map<string, Array<(typeof rows)[number]>>();
  const lastReplyByRun = new Map<string, string>();
  for (const row of rows) {
    const { item } = row;
    if (item.runId === null || row.visibility === "inherited") continue;
    if (item.type === "assistant_message") {
      lastReplyByRun.set(item.runId, item.messageId);
    } else if (
      item.type === "file_change" &&
      (item.fileName.includes(STUDIO_ROOT) ||
        (item.changes ?? []).some((change) => change.path.includes(STUDIO_ROOT)))
    ) {
      const runRows = fileRowsByRun.get(item.runId) ?? [];
      runRows.push(row);
      fileRowsByRun.set(item.runId, runRows);
    }
  }

  const result = new Map<string, ReadonlyArray<StudioTurnSet>>();
  for (const [runId, runRows] of fileRowsByRun) {
    const messageId = lastReplyByRun.get(runId);
    if (messageId === undefined) continue;
    const sets = new Map<string, { revision: string; live: boolean }>();
    for (const file of collectThreadMadeFiles(runRows, cwd).written.toReversed()) {
      const match = SET_FOLDER.exec(file.folder);
      if (match === null) continue;
      const setPath = `${STUDIO_ROOT}/${match[1]}`;
      const previous = sets.get(setPath);
      sets.set(setPath, {
        revision:
          previous !== undefined && previous.revision > file.changedAt
            ? previous.revision
            : file.changedAt,
        live: (previous?.live ?? false) || file.change !== "deleted",
      });
    }
    const cards = [...sets].flatMap(([setPath, { revision, live }]) =>
      live ? [{ setPath, name: setPath.slice(STUDIO_ROOT.length + 1), revision }] : [],
    );
    if (cards.length > 0) result.set(messageId, cards);
  }
  return result;
}
