import { describe, expect, it } from "vite-plus/test";

import {
  assignThreadWorkspace,
  filterThreadsForWorkspace,
  isWorkspaceSeedPrompt,
  workspaceSeedPrompt,
} from "./workspaces.logic";

const skill = (name: string, enabled = true) => ({ name, path: `/skills/${name}`, enabled });

describe("workspaces", () => {
  it("lists untagged chats in Code and forks and subagents with their root", () => {
    const threads = [
      { id: "plain", lineage: { rootThreadId: "plain" } },
      { id: "deck", lineage: { rootThreadId: "deck" } },
      { id: "deck-fork", lineage: { rootThreadId: "deck" } },
      { id: "unknown", lineage: { rootThreadId: "unknown" } },
    ];
    const tags = { deck: "present", unknown: "workspace-from-a-newer-client" };
    expect(filterThreadsForWorkspace(threads, "code", tags).map((t) => t.id)).toEqual([
      "plain",
      "unknown",
    ]);
    expect(filterThreadsForWorkspace(threads, "present", tags).map((t) => t.id)).toEqual([
      "deck",
      "deck-fork",
    ]);
  });

  it("starts with the skill only when a provider has it enabled", () => {
    expect(workspaceSeedPrompt("present", [{ skills: [skill("gs-present")] }])).toBe(
      "$gs-present ",
    );
    expect(workspaceSeedPrompt("present", [{ skills: [skill("gs-present", false)] }])).toBe("");
    expect(workspaceSeedPrompt("mail", [{ skills: [skill("gs-present")] }])).toBe("");
    expect(workspaceSeedPrompt("code", [{ skills: [skill("gs-present")] }])).toBe("");
  });

  it("treats only a bare workspace skill as untouched", () => {
    expect(isWorkspaceSeedPrompt("$gs-present ")).toBe(true);
    expect(isWorkspaceSeedPrompt("$gs-present make it shorter")).toBe(false);
    expect(isWorkspaceSeedPrompt("$gs-video ")).toBe(false);
  });

  it("drops the tag when a draft is reused in Code", () => {
    const tagged = assignThreadWorkspace({}, "t1", "write");
    expect(tagged).toEqual({ t1: "write" });
    expect(assignThreadWorkspace(tagged, "t1", "code")).toEqual({});
  });
});
