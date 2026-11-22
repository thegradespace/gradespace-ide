import type { WorkspaceId } from "@t3tools/client-runtime/workspaces";

import type { AppSymbolName } from "../../components/ui/AppSymbol";

// Closest mobile icons to the desktop rail's.
export const WORKSPACE_SYMBOLS: Record<WorkspaceId, AppSymbolName> = {
  code: "chevron.left.forwardslash.chevron.right",
  present: "desktopcomputer",
  studio: "square.grid.2x2",
  research: "magnifyingglass",
  write: "pencil",
  mail: "envelope",
  qa: "checkmark.shield",
  career: "briefcase",
};
