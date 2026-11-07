import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  assignThreadWorkspace,
  DEFAULT_WORKSPACE_ID,
  filterThreadsForWorkspace,
  isWorkspaceId,
  isWorkspaceSeedPrompt,
  type WorkspaceId,
  type WorkspaceSeedSettings,
  workspaceSeedPrompt,
} from "@t3tools/client-runtime/workspaces";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import type * as MobilePreferences from "../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";

type Providers = ReadonlyArray<{ readonly skills: ReadonlyArray<ServerProviderSkill> }>;

const EMPTY_TAGS: Readonly<Record<string, string>> = {};

function activeWorkspaceOf(preferences: MobilePreferences.Preferences): WorkspaceId {
  return isWorkspaceId(preferences.activeWorkspace)
    ? preferences.activeWorkspace
    : DEFAULT_WORKSPACE_ID;
}

function seedSettingsOf(preferences: MobilePreferences.Preferences): WorkspaceSeedSettings {
  return {
    presentStyle: preferences.presentStyle ?? null,
    writeMode: preferences.writeMode ?? "draft",
    reviewerStyle: preferences.reviewerStyle ?? "balanced",
  };
}

function readPreferences(): MobilePreferences.Preferences {
  const result = appAtomRegistry.get(mobilePreferencesAtom);
  return AsyncResult.isSuccess(result) ? result.value : {};
}

export function useWorkspacePreferences() {
  const result = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(result) ? result.value : {};
  return {
    active: activeWorkspaceOf(preferences),
    threadWorkspaces: preferences.threadWorkspaces ?? EMPTY_TAGS,
    seedSettings: seedSettingsOf(preferences),
    setActive: (workspace: WorkspaceId) => save({ activeWorkspace: workspace }),
  };
}

/** Code lists every thread on the phone: the tag map is per device, so desktop chats arrive untagged. */
export function threadsForWorkspace<
  T extends { readonly id: string; readonly lineage?: { readonly rootThreadId: string } | null },
>(
  threads: ReadonlyArray<T>,
  workspace: WorkspaceId,
  threadWorkspaces: Readonly<Record<string, string>>,
): ReadonlyArray<T> {
  return workspace === DEFAULT_WORKSPACE_ID
    ? threads
    : filterThreadsForWorkspace(threads, workspace, threadWorkspaces);
}

/** Queued new chats follow their thread's tag; unsent drafts stay visible everywhere. */
export function pendingTasksForWorkspace<
  T extends { readonly kind: string; readonly message?: { readonly threadId: string } },
>(
  tasks: ReadonlyArray<T>,
  workspace: WorkspaceId,
  threadWorkspaces: Readonly<Record<string, string>>,
): ReadonlyArray<T> {
  if (workspace === DEFAULT_WORKSPACE_ID) return tasks;
  return tasks.filter(
    (task) =>
      task.message === undefined ||
      filterThreadsForWorkspace([{ id: task.message.threadId }], workspace, threadWorkspaces)
        .length > 0,
  );
}

export function readActiveWorkspace(): WorkspaceId {
  return activeWorkspaceOf(readPreferences());
}

export function recordThreadWorkspace(threadId: string, workspace: WorkspaceId): void {
  appAtomRegistry.set(updateMobilePreferencesAtom, {
    transform: (current) => {
      const tags = current.threadWorkspaces ?? EMPTY_TAGS;
      const next = assignThreadWorkspace(tags, threadId, workspace);
      return next === tags ? {} : { threadWorkspaces: next };
    },
  });
}

/** Fills an untouched new-task draft with the active workspace's skill and style line. */
export function seedNewTaskDraft(draftKey: string, providers: Providers): void {
  const prompt = getComposerDraftSnapshot(draftKey).text;
  if (prompt.trim() !== "" && !isWorkspaceSeedPrompt(prompt)) return;
  const preferences = readPreferences();
  const seed = workspaceSeedPrompt(
    activeWorkspaceOf(preferences),
    providers,
    seedSettingsOf(preferences),
  );
  if (seed !== prompt) setComposerDraftText(draftKey, seed);
}

/** Saves a Present or Write default, then refreshes the draft if it still holds only a seed. */
export function updateWorkspaceSeedSettings(
  patch: Partial<WorkspaceSeedSettings>,
  draft: { readonly key: string; readonly providers: Providers } | null,
): void {
  appAtomRegistry.set(updateMobilePreferencesAtom, patch);
  if (draft === null) return;
  const prompt = getComposerDraftSnapshot(draft.key).text;
  if (prompt.trim() !== "" && !isWorkspaceSeedPrompt(prompt)) return;
  const preferences = readPreferences();
  setComposerDraftText(
    draft.key,
    workspaceSeedPrompt(activeWorkspaceOf(preferences), draft.providers, {
      ...seedSettingsOf(preferences),
      ...patch,
    }),
  );
}
