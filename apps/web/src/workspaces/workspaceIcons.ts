import {
  CodeXmlIcon,
  LayoutGridIcon,
  MailIcon,
  MonitorIcon,
  PencilIcon,
  SearchIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";

import type { WorkspaceId } from "./workspaces.logic";

export const WORKSPACE_ICONS: Record<WorkspaceId, LucideIcon> = {
  code: CodeXmlIcon,
  present: MonitorIcon,
  studio: LayoutGridIcon,
  research: SearchIcon,
  write: PencilIcon,
  mail: MailIcon,
  qa: ShieldCheckIcon,
};
