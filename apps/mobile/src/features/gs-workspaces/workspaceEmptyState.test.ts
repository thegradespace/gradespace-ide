import { describe, expect, it } from "vite-plus/test";

import { showsAppEmptyState, workspaceEmptyCopy } from "./workspaceEmptyState";

describe("workspace empty state", () => {
  it("keeps an empty workspace's list, and its switcher, instead of the app-wide empty screen", () => {
    const ready = { hasAnyThreads: false, hasReadyEnvironment: true };
    expect(showsAppEmptyState({ ...ready, workspace: "present" })).toBe(false);
    expect(showsAppEmptyState({ ...ready, workspace: "code" })).toBe(true);
    expect(showsAppEmptyState({ ...ready, workspace: "present", hasAnyThreads: true })).toBe(false);
    // With nothing connected, the app-wide screen offers to add an environment.
    expect(showsAppEmptyState({ ...ready, workspace: "present", hasReadyEnvironment: false })).toBe(
      true,
    );
    expect(workspaceEmptyCopy("present")).toEqual({
      title: "No Present chats yet",
      actionLabel: "New deck",
    });
  });
});
