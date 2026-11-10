import type { QuickAction, QuickActionRunIn, ScopedProjectRef } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  type NewThreadHandler,
  readLastUsedProjectKey,
  resolveDefaultProjectRef,
} from "../hooks/useHandleNewThread";
import { resolveThreadActionProjectRef } from "../lib/chatThreadActions";
import { readProjects, readThreadShell } from "../state/entities";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import {
  openImproveLauncher,
  readQuickActionChat,
  requestQuickActionDraftSend,
} from "./quickActionsStore";

/** The project the open chat belongs to, else the first project in the sidebar. */
function readCurrentProjectRef(router: AnyRouter): ScopedProjectRef | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const drafts = useComposerDraftStore.getState();
  const activeThread = target?.kind === "server" ? readThreadShell(target.threadRef) : null;
  const activeDraftThread = target
    ? target.kind === "server"
      ? drafts.getDraftThread(target.threadRef)
      : drafts.getDraftSession(target.draftId)
    : null;
  return resolveThreadActionProjectRef({
    activeThread: activeThread ?? undefined,
    activeDraftThread,
    defaultProjectRef: resolveDefaultProjectRef(
      readProjects(),
      useUiStateStore.getState().projectOrder,
      readLastUsedProjectKey(),
    ),
    handleNewThread: () => Promise.resolve(null),
  });
}

function failed(title: string, description: string) {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

/** Sends or prefills text the way the composer would, in a new draft or the open chat. */
export async function runQuickActionPrompt(input: {
  readonly text: string;
  readonly behavior: "send" | "prefill";
  readonly runIn: QuickActionRunIn;
  readonly projectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}): Promise<void> {
  const chat = input.runIn === "this-chat" ? readQuickActionChat() : null;
  if (chat && input.behavior === "prefill") {
    if (!chat.prefill(input.text)) {
      failed("Could not add the prompt", "The composer is busy; try again once it is ready.");
    }
    return;
  }
  if (chat?.kind === "server") {
    await chat.send(input.text).catch((error: unknown) => {
      failed(
        "Could not run the quick action",
        error instanceof Error ? error.message : "The message was not sent.",
      );
    });
    return;
  }
  // A draft is "this chat" too: the new-thread handler reuses an empty draft in its project.
  if (input.projectRef === null) {
    failed("No project to run in", "Add or open a project first.");
    return;
  }
  const opened = await input
    .handleNewThread(input.projectRef, { prompt: input.text })
    .catch(() => null);
  if (opened === null || input.behavior !== "send") return;
  const prompt = useComposerDraftStore.getState().getComposerDraft(opened.draftId)?.prompt;
  // The handler keeps a draft's own text, so only a draft holding this prompt sends.
  if (prompt === input.text) requestQuickActionDraftSend(opened.draftId);
}

export function runQuickAction(
  action: QuickAction,
  runIn: QuickActionRunIn,
  deps: { readonly router: AnyRouter; readonly handleNewThread: NewThreadHandler },
): Promise<void> {
  const projectRef = readCurrentProjectRef(deps.router);
  if (action.behavior === "improve-launcher") {
    if (projectRef === null) {
      failed("No project to improve", "Add or open a project first.");
    } else {
      openImproveLauncher(action.id, projectRef);
    }
    return Promise.resolve();
  }
  return runQuickActionPrompt({
    text: action.prompt,
    behavior: action.behavior,
    runIn,
    projectRef,
    handleNewThread: deps.handleNewThread,
  });
}
