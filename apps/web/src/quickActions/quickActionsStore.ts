import type { DraftId } from "../composerDraftStore";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { create } from "zustand";

interface QuickActionsUiState {
  readonly paletteOpen: boolean;
  readonly launcher: { readonly actionId: string; readonly projectRef: ScopedProjectRef } | null;
  /** Drafts seeded by a quick action that send once their chat view mounts. */
  readonly pendingDraftSends: ReadonlySet<DraftId>;
}

export const useQuickActionsStore = create<QuickActionsUiState>(() => ({
  paletteOpen: false,
  launcher: null,
  pendingDraftSends: new Set(),
}));

export function setQuickActionsPaletteOpen(open: boolean): void {
  useQuickActionsStore.setState({ paletteOpen: open });
}

export function openImproveLauncher(actionId: string, projectRef: ScopedProjectRef): void {
  useQuickActionsStore.setState({ paletteOpen: false, launcher: { actionId, projectRef } });
}

export function closeImproveLauncher(): void {
  useQuickActionsStore.setState({ launcher: null });
}

export function requestQuickActionDraftSend(draftId: DraftId): void {
  const pending = new Set(useQuickActionsStore.getState().pendingDraftSends);
  pending.add(draftId);
  useQuickActionsStore.setState({ pendingDraftSends: pending });
}

/** True once per request, so a re-render cannot send the same draft twice. */
export function takeQuickActionDraftSend(draftId: DraftId): boolean {
  const current = useQuickActionsStore.getState().pendingDraftSends;
  if (!current.has(draftId)) return false;
  const pending = new Set(current);
  pending.delete(draftId);
  useQuickActionsStore.setState({ pendingDraftSends: pending });
  return true;
}

/** The main chat view on screen, which "this chat" runs in. */
export interface QuickActionChatTarget {
  readonly kind: "server" | "draft";
  readonly send: (text: string) => Promise<void>;
  readonly prefill: (text: string) => boolean;
}

let activeChat: QuickActionChatTarget | null = null;

export function registerQuickActionChat(target: QuickActionChatTarget): () => void {
  activeChat = target;
  return () => {
    if (activeChat === target) activeChat = null;
  };
}

export function readQuickActionChat(): QuickActionChatTarget | null {
  return activeChat;
}
