import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  writeLocalStorageValue,
} from "../hooks/useLocalStorage";
import { getClientSettings, updateClientSettings, useClientSettings } from "../hooks/useSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import {
  assignThreadWorkspace,
  DEFAULT_WORKSPACE_ID,
  isWorkspaceId,
  isWorkspaceSeedPrompt,
  type WorkspaceId,
  type WorkspaceSeedSettings,
  workspaceSeedPrompt,
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

/** Saves a Present or Write default, then refreshes an untouched composer to the new seed. */
export function updateWorkspaceSeedSettings(
  patch: Partial<WorkspaceSeedSettings>,
  composer: {
    readonly target: ScopedThreadRef | DraftId;
    readonly environmentId: EnvironmentId;
    readonly workspace: WorkspaceId;
  },
): void {
  const next = { ...getClientSettings(), ...patch };
  void updateClientSettings(patch).catch((error: unknown) => {
    console.error("Could not save the workspace default.", error);
  });
  const drafts = useComposerDraftStore.getState();
  const prompt = drafts.getComposerDraft(composer.target)?.prompt ?? "";
  if (prompt.trim() !== "" && !isWorkspaceSeedPrompt(prompt)) return;
  const providers =
    appAtomRegistry.get(environmentServerConfigsAtom).get(composer.environmentId)?.providers ?? [];
  drafts.setPrompt(composer.target, workspaceSeedPrompt(composer.workspace, providers, next));
}
