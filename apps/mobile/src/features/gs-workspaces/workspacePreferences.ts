import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  assignThreadWorkspace,
  DEFAULT_WORKSPACE_ID,
  filterThreadsForWorkspace,
  isWorkspaceId,
  isWorkspaceSeedPrompt,
  planThreadWorkspaceSync,
  threadWorkspaceTags,
  type WorkspaceId,
  type WorkspaceSeedSettings,
  workspaceSeedPrompt,
  withoutThreadWorkspaces,
} from "@t3tools/client-runtime/workspaces";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";

import type * as MobilePreferences from "../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
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
    seedSettings: seedSettingsOf(preferences),
    setActive: (workspace: WorkspaceId) => save({ activeWorkspace: workspace }),
  };
}

/** Each thread's workspace tag: the server's, else this phone's until it reaches the server. */
export function useThreadWorkspaces(): Readonly<Record<string, string>> {
  const result = useAtomValue(mobilePreferencesAtom);
  const local =
    (AsyncResult.isSuccess(result) ? result.value.threadWorkspaces : undefined) ?? EMPTY_TAGS;
  const threads = useAtomValue(environmentThreadShells.quietThreadShellsAtom);
  return useMemo(() => threadWorkspaceTags(threads, local), [threads, local]);
}

/**
 * Hands this phone's tags to each thread's server, then forgets them once the server's tag
 * shows up. Covers the one-time migration and chats tagged before their thread existed.
 */
export function installThreadWorkspaceSync(): () => void {
  // Sent or failed this launch; a failure waits for the next launch instead of retrying per update.
  const attempted = new Set<string>();
  const sync = () => {
    const result = appAtomRegistry.get(mobilePreferencesAtom);
    if (!AsyncResult.isSuccess(result)) return;
    const local = result.value.threadWorkspaces ?? EMPTY_TAGS;
    const plan = planThreadWorkspaceSync(
      appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
      local,
    );
    for (const { thread, workspace } of plan.push) {
      if (attempted.has(thread.id)) continue;
      attempted.add(thread.id);
      void runAtomCommand(
        appAtomRegistry,
        threadEnvironment.setWorkspace,
        { environmentId: thread.environmentId, input: { threadId: thread.id, workspace } },
        { reportFailure: false },
      );
    }
    if (plan.drop.length === 0) return;
    appAtomRegistry.set(updateMobilePreferencesAtom, {
      transform: (current) => {
        const tags = current.threadWorkspaces ?? EMPTY_TAGS;
        const next = withoutThreadWorkspaces(tags, plan.drop);
        return next === tags ? {} : { threadWorkspaces: next };
      },
    });
  };
  const unsubscribes = [
    appAtomRegistry.subscribe(environmentThreadShells.threadShellsAtom, sync),
    appAtomRegistry.subscribe(mobilePreferencesAtom, sync),
  ];
  sync();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/** Code lists every thread on the phone; older servers leave desktop chats untagged here. */
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
