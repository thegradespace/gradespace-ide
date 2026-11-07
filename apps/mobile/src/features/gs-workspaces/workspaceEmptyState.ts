import {
  DEFAULT_WORKSPACE_ID,
  workspaceDefinition,
  type WorkspaceId,
} from "@t3tools/client-runtime/workspaces";

/**
 * Only Code, which lists every thread, gives way to the app-wide empty screen. An empty
 * workspace keeps the list and its workspace switcher, or there would be no way back.
 */
export function showsAppEmptyState(input: {
  readonly hasAnyThreads: boolean;
  readonly workspace: WorkspaceId;
  readonly hasReadyEnvironment: boolean;
}): boolean {
  return (
    !input.hasAnyThreads && (input.workspace === DEFAULT_WORKSPACE_ID || !input.hasReadyEnvironment)
  );
}

/** "No Present chats yet" with the sidebar's own new-chat label, such as "New deck". */
export function workspaceEmptyCopy(workspace: WorkspaceId) {
  const definition = workspaceDefinition(workspace);
  return {
    title: `No ${definition.label} chats yet`,
    actionLabel: definition.newChatLabel,
  };
}
