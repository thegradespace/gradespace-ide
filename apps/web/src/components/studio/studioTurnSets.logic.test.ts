import {
  NodeId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { collectStudioTurnSets } from "./studioTurnSets.logic";

const threadId = ThreadId.make("thread-studio-sets");

function row(
  index: number,
  runId: string,
  item: Record<string, unknown>,
  visibility: OrchestrationV2ProjectedTurnItem["visibility"] = "local",
): OrchestrationV2ProjectedTurnItem {
  const at = DateTime.makeUnsafe(`2026-11-04T10:${String(index).padStart(2, "0")}:00.000Z`);
  const id = TurnItemId.make(`item-${index}`);
  return {
    position: index,
    visibility,
    sourceThreadId: threadId,
    sourceItemId: id,
    item: {
      id,
      threadId,
      runId: RunId.make(runId),
      nodeId: NodeId.make("node-1"),
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: index,
      status: "completed",
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
      ...item,
    } as OrchestrationV2TurnItem,
  };
}

const write = (index: number, runId: string, fileName: string) =>
  row(index, runId, { type: "file_change", fileName });
const patch = (index: number, runId: string, changes: Array<{ operation: string; path: string }>) =>
  row(index, runId, { type: "file_change", fileName: changes[0]?.path, changes });
const reply = (index: number, runId: string, messageId: string) =>
  row(index, runId, { type: "assistant_message", messageId, text: "Done." });

const cwd = "/work/app";
const studio = "/work/app/.gradespace/studio";

describe("collectStudioTurnSets", () => {
  it("gives one card per set per turn, under the turn's last reply", () => {
    const sets = collectStudioTurnSets(
      [
        write(1, "run-1", `${studio}/2026-11-03-hero/a.html`),
        reply(2, "run-1", "m-early"),
        patch(3, "run-1", [
          { operation: "add", path: ".gradespace/studio/2026-11-03-hero/b.html" },
          { operation: "update", path: `${studio}/2026-11-03-hero/studio.json` },
          { operation: "add", path: `${studio}/2026-11-04-deck/assets/one.png` },
        ]),
        write(4, "run-1", "/work/app/src/app.ts"),
        reply(5, "run-1", "m-last"),
        write(6, "run-2", `${studio}/2026-11-03-hero/a.html`),
        reply(7, "run-2", "m-second"),
      ],
      cwd,
    );
    expect([...sets.keys()]).toEqual(["m-last", "m-second"]);
    expect(sets.get("m-last")).toEqual([
      {
        setPath: ".gradespace/studio/2026-11-03-hero",
        name: "2026-11-03-hero",
        revision: "2026-11-04T10:03:00.000Z",
      },
      {
        setPath: ".gradespace/studio/2026-11-04-deck",
        name: "2026-11-04-deck",
        revision: "2026-11-04T10:03:00.000Z",
      },
    ]);
    expect(sets.get("m-second")?.map((set) => set.revision)).toEqual(["2026-11-04T10:06:00.000Z"]);
  });

  it("skips files outside a set, inherited rows, turns without a reply, and deleted sets", () => {
    const sets = collectStudioTurnSets(
      [
        write(1, "run-1", `${studio}/notes.md`),
        write(2, "run-1", "/elsewhere/.gradespace/studio/other/a.html"),
        row(
          3,
          "run-1",
          { type: "file_change", fileName: `${studio}/inherited/a.html` },
          "inherited",
        ),
        patch(4, "run-1", [{ operation: "delete", path: `${studio}/gone/a.html` }]),
        reply(5, "run-1", "m-1"),
        write(6, "run-2", `${studio}/no-reply/a.html`),
      ],
      cwd,
    );
    expect(sets.size).toBe(0);
  });
});
