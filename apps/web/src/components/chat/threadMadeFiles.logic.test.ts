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

import { collectThreadMadeFiles } from "./threadMadeFiles.logic";

const threadId = ThreadId.make("thread-made-files");

function row(
  index: number,
  item: Record<string, unknown>,
  visibility: OrchestrationV2ProjectedTurnItem["visibility"] = "local",
): OrchestrationV2ProjectedTurnItem {
  const at = DateTime.makeUnsafe(`2026-11-04T10:0${index}:00.000Z`);
  const id = TurnItemId.make(`item-${index}`);
  return {
    position: index,
    visibility,
    sourceThreadId: threadId,
    sourceItemId: id,
    item: {
      id,
      threadId,
      runId: RunId.make("run-1"),
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

const claudeWrite = (index: number, fileName: string, status = "completed") =>
  row(index, { type: "file_change", fileName, status });

const codexPatch = (index: number, changes: Array<{ operation: string; path: string }>) =>
  row(index, { type: "file_change", fileName: changes[0]?.path, changes });

describe("collectThreadMadeFiles", () => {
  const cwd = "/work/app";

  it("lists Claude and Codex file changes newest first, inside and outside the project", () => {
    const { written } = collectThreadMadeFiles(
      [
        claudeWrite(1, "/Users/sam/Documents/FEMAJ/report.pdf"),
        codexPatch(2, [
          { operation: "add", path: "/work/app/src/new.ts" },
          { operation: "update", path: "/work/app/src/old.ts" },
        ]),
        claudeWrite(3, "notes.md"),
      ],
      cwd,
    );
    expect(written.map((file) => [file.path, file.folder, file.change])).toEqual([
      ["/work/app/notes.md", "", null],
      ["/work/app/src/new.ts", "src", "created"],
      ["/work/app/src/old.ts", "src", "edited"],
      ["/Users/sam/Documents/FEMAJ/report.pdf", "~/Documents/FEMAJ", null],
    ]);
  });

  it("resolves relative paths against the thread cwd and dedupes one file", () => {
    const { written } = collectThreadMadeFiles(
      [
        codexPatch(1, [{ operation: "add", path: "out/../out/a.txt" }]),
        claudeWrite(2, "./out/a.txt"),
        codexPatch(3, [{ operation: "update", path: "/work/app/out/a.txt" }]),
      ],
      cwd,
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      path: "/work/app/out/a.txt",
      name: "a.txt",
      change: "created",
      changedAt: "2026-11-04T10:03:00.000Z",
    });
  });

  it("reports a file deleted after it was written, and skips failed, inherited, and nameless changes", () => {
    const { written } = collectThreadMadeFiles(
      [
        codexPatch(1, [{ operation: "add", path: "/work/app/tmp.txt" }]),
        codexPatch(2, [{ operation: "delete", path: "/work/app/tmp.txt" }]),
        claudeWrite(3, "/work/app/failed.txt", "failed"),
        row(4, { type: "file_change", fileName: "/work/app/old-thread.txt" }, "inherited"),
        claudeWrite(5, "Write result"),
      ],
      cwd,
    );
    expect(written.map((file) => [file.path, file.change])).toEqual([
      ["/work/app/tmp.txt", "deleted"],
    ]);
  });

  it("lists files named in replies that no tool wrote, once", () => {
    const { written, mentioned } = collectThreadMadeFiles(
      [
        claudeWrite(1, "/work/app/made.md"),
        row(2, {
          type: "assistant_message",
          text: "Done. I saved [the summary](/work/app/made.md) and ~/Documents/FEMAJ/final report.pdf is next to /Users/sam/Documents/FEMAJ/final.pdf.",
        }),
        row(3, {
          type: "assistant_message",
          text: "Also see /Users/sam/Documents/FEMAJ/final.pdf",
        }),
        row(4, {
          type: "assistant_message",
          text: "Visit https://example.com/a.pdf or run /bin/ls.",
        }),
      ],
      cwd,
    );
    expect(written.map((file) => file.path)).toEqual(["/work/app/made.md"]);
    expect(mentioned.map((file) => file.path)).toEqual(["/Users/sam/Documents/FEMAJ/final.pdf"]);
  });
});
