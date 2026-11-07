import { describe, expect, it } from "vite-plus/test";

import {
  assignThreadWorkspace,
  filterThreadsForWorkspace,
  isWorkspaceSeedPrompt,
  presentationStyleLine,
  reviewerStyleLine,
  workspaceSeedPrompt,
} from "./workspaces.ts";

describe("workspace message lines", () => {
  it("names the preset and only the parts that differ from it", () => {
    expect(presentationStyleLine(null)).toBeNull();
    expect(presentationStyleLine({ name: "Unknown" })).toBeNull();
    expect(presentationStyleLine({ name: "Bold" })).toBe("Style: Bold");
    expect(
      presentationStyleLine({
        name: "Bold",
        accent: "#ff5a4e",
        headingFont: "Avenir Next Condensed",
      }),
    ).toBe("Style: Bold");
    expect(
      presentationStyleLine({
        name: "Bold",
        background: "#000000",
        bodyFont: "Inter",
        accent: "#00ff88",
        second: "#FFD23F",
        headingFont: "Futura",
      }),
    ).toBe(
      "Style: Bold · accent #00FF88 · heading font Futura · body font Inter · background #000000",
    );
  });

  it("names the reviewer style by its label", () => {
    expect(reviewerStyleLine("editor-triage")).toBe("Reviewer style: Editor triage");
    expect(reviewerStyleLine("harsh")).toBe("Reviewer style: Harsh");
  });
});

const skill = (name: string, enabled = true) => ({ name, path: `/skills/${name}`, enabled });
const defaults = { presentStyle: null, writeMode: "draft", reviewerStyle: "balanced" } as const;

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
    const present = [{ skills: [skill("gs-present")] }];
    expect(workspaceSeedPrompt("present", present, defaults)).toBe("$gs-present ");
    expect(
      workspaceSeedPrompt("present", [{ skills: [skill("gs-present", false)] }], defaults),
    ).toBe("");
    expect(workspaceSeedPrompt("mail", present, defaults)).toBe("");
    expect(workspaceSeedPrompt("code", present, defaults)).toBe("");
  });

  it("adds the chosen style, and Write's Review mode starts gs-review with a reviewer style", () => {
    const providers = [{ skills: [skill("gs-present"), skill("gs-write"), skill("gs-review")] }];
    expect(
      workspaceSeedPrompt("present", providers, {
        ...defaults,
        presentStyle: { name: "Bold", accent: "#00FF88" },
      }),
    ).toBe("$gs-present\nStyle: Bold · accent #00FF88\n");
    expect(workspaceSeedPrompt("write", providers, defaults)).toBe("$gs-write ");
    expect(
      workspaceSeedPrompt("write", providers, {
        ...defaults,
        writeMode: "review",
        reviewerStyle: "harsh",
      }),
    ).toBe("$gs-review\nReviewer style: Harsh\n");
  });

  it("treats only a bare workspace skill as untouched", () => {
    expect(isWorkspaceSeedPrompt("$gs-present ")).toBe(true);
    expect(isWorkspaceSeedPrompt("$gs-present make it shorter")).toBe(false);
    expect(isWorkspaceSeedPrompt("$gs-video ")).toBe(false);
    expect(isWorkspaceSeedPrompt("$gs-present\nStyle: Bold · accent #00FF88\n")).toBe(true);
    expect(isWorkspaceSeedPrompt("$gs-review\nReviewer style: Harsh\n")).toBe(true);
    expect(isWorkspaceSeedPrompt("$gs-present\nStyle: Bold\nmake it about tides")).toBe(false);
  });

  it("drops the tag when a draft is reused in Code", () => {
    const tagged = assignThreadWorkspace({}, "t1", "write");
    expect(tagged).toEqual({ t1: "write" });
    expect(assignThreadWorkspace(tagged, "t1", "code")).toEqual({});
  });
});
