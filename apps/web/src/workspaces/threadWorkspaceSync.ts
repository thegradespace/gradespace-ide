import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { AtomRegistry } from "effect/reactivity";

import {
  getClientSettings,
  getClientSettingsHydratedSnapshot,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
  updateClientSettings,
} from "../hooks/useSettings";
import { environmentThreadShells, threadEnvironment } from "../state/threads";
import { planThreadWorkspaceSync, withoutThreadWorkspaces } from "./workspaces.logic";

/**
 * Hands this device's workspace tags to each thread's server, then forgets them once the
 * server's tag shows up. Covers the one-time migration and chats tagged as drafts alike.
 */
export function startThreadWorkspaceSync(registry: AtomRegistry.AtomRegistry): () => void {
  // Sent or failed this session; a failure waits for the next launch instead of retrying per update.
  const attempted = new Set<string>();
  const sync = () => {
    if (!getClientSettingsHydratedSnapshot()) return;
    const local = getClientSettings().threadWorkspaces;
    const plan = planThreadWorkspaceSync(
      registry.get(environmentThreadShells.threadShellsAtom),
      local,
    );
    for (const { thread, workspace } of plan.push) {
      if (attempted.has(thread.id)) continue;
      attempted.add(thread.id);
      void runAtomCommand(
        registry,
        threadEnvironment.setWorkspace,
        { environmentId: thread.environmentId, input: { threadId: thread.id, workspace } },
        { reportFailure: false },
      );
    }
    const next = withoutThreadWorkspaces(local, plan.drop);
    if (next === local) return;
    void updateClientSettings({ threadWorkspaces: next }).catch((error: unknown) => {
      console.error("Could not tidy the device's workspace tags.", error);
    });
  };
  const unsubscribes = [
    registry.subscribe(environmentThreadShells.threadShellsAtom, sync),
    subscribeClientSettings(sync),
    subscribeClientSettingsHydration(sync),
  ];
  sync();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
