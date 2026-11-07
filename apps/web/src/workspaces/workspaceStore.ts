import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  writeLocalStorageValue,
} from "../hooks/useLocalStorage";
import { getClientSettings, updateClientSettings, useClientSettings } from "../hooks/useSettings";
import {
  assignThreadWorkspace,
  DEFAULT_WORKSPACE_ID,
  isWorkspaceId,
  type WorkspaceId,
} from "./workspaces.logic";

const ACTIVE_WORKSPACE_STORAGE_KEY = "t3code:active-workspace:v1";

function readStoredWorkspace(): WorkspaceId {
  const stored = readLocalStorageValue(ACTIVE_WORKSPACE_STORAGE_KEY, "", Schema.String);
  return isWorkspaceId(stored) ? stored : DEFAULT_WORKSPACE_ID;
}

function subscribeStoredWorkspace(onChange: () => void): () => void {
  return subscribeLocalStorageKey(ACTIVE_WORKSPACE_STORAGE_KEY, onChange);
}

/** Hiding the rail turns workspaces off, so nobody is left filtered with no way back. */
export function readActiveWorkspace(): WorkspaceId {
  return getClientSettings().workspaceRailEnabled ? readStoredWorkspace() : DEFAULT_WORKSPACE_ID;
}

export function useActiveWorkspace(): WorkspaceId {
  const railEnabled = useClientSettings((settings) => settings.workspaceRailEnabled);
  const stored = useSyncExternalStore(subscribeStoredWorkspace, readStoredWorkspace);
  return railEnabled ? stored : DEFAULT_WORKSPACE_ID;
}

export function setActiveWorkspace(workspace: WorkspaceId): void {
  writeLocalStorageValue(ACTIVE_WORKSPACE_STORAGE_KEY, workspace, "", Schema.String);
}

export function useThreadWorkspaces(): Readonly<Record<string, string>> {
  return useClientSettings((settings) => settings.threadWorkspaces);
}

export function recordThreadWorkspace(threadId: string, workspace: WorkspaceId): void {
  const current = getClientSettings().threadWorkspaces;
  const next = assignThreadWorkspace(current, threadId, workspace);
  if (next === current) return;
  void updateClientSettings({ threadWorkspaces: next }).catch((error: unknown) => {
    console.error("Could not save the chat's workspace.", error);
  });
}
