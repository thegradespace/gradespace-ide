import type { ServerProviderSkill, WorkspaceKeybindingCommand } from "@t3tools/contracts";

export type WorkspaceId = "code" | "present" | "studio" | "research" | "write" | "mail" | "qa";

export interface WorkspaceDefinition {
  readonly id: WorkspaceId;
  readonly label: string;
  readonly command: WorkspaceKeybindingCommand;
  /** The sidebar's new-chat label. */
  readonly newChatLabel: string;
  /** Skill a new chat starts with, as a `$skill` mention. */
  readonly skill: string | null;
  readonly opensStudio: boolean;
}

export const WORKSPACES: ReadonlyArray<WorkspaceDefinition> = [
  {
    id: "code",
    label: "Code",
    command: "workspaces.code",
    newChatLabel: "New thread",
    skill: null,
    opensStudio: false,
  },
  {
    id: "present",
    label: "Present",
    command: "workspaces.present",
    newChatLabel: "New deck",
    skill: "gs-present",
    opensStudio: true,
  },
  {
    id: "studio",
    label: "Studio",
    command: "workspaces.studio",
    newChatLabel: "New design",
    skill: "gs-design",
    opensStudio: true,
  },
  {
    id: "research",
    label: "Research",
    command: "workspaces.research",
    newChatLabel: "New research",
    skill: "gs-research",
    opensStudio: false,
  },
  {
    id: "write",
    label: "Write",
    command: "workspaces.write",
    newChatLabel: "New draft",
    skill: "gs-write",
    opensStudio: false,
  },
  {
    id: "mail",
    label: "Mail",
    command: "workspaces.mail",
    newChatLabel: "New email",
    skill: "gs-mail",
    opensStudio: false,
  },
  {
    id: "qa",
    label: "QA",
    command: "workspaces.qa",
    newChatLabel: "New QA run",
    skill: "gs-qa",
    opensStudio: false,
  },
];

export const DEFAULT_WORKSPACE_ID: WorkspaceId = "code";

const WORKSPACE_BY_ID = new Map(WORKSPACES.map((workspace) => [workspace.id, workspace]));

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === "string" && WORKSPACE_BY_ID.has(value as WorkspaceId);
}

export function workspaceDefinition(id: WorkspaceId): WorkspaceDefinition {
  return WORKSPACE_BY_ID.get(id) ?? WORKSPACE_BY_ID.get(DEFAULT_WORKSPACE_ID)!;
}

export function workspaceForCommand(command: string | null): WorkspaceId | null {
  return WORKSPACES.find((workspace) => workspace.command === command)?.id ?? null;
}

/** A thread's own workspace, else its root's, so forks and subagents follow the chat they came from. */
export function resolveThreadWorkspace(
  thread: { readonly id: string; readonly lineage?: { readonly rootThreadId: string } | null },
  threadWorkspaces: Readonly<Record<string, string>>,
): WorkspaceId {
  const own = threadWorkspaces[thread.id] ?? threadWorkspaces[thread.lineage?.rootThreadId ?? ""];
  return isWorkspaceId(own) ? own : DEFAULT_WORKSPACE_ID;
}

export function filterThreadsForWorkspace<
  T extends { readonly id: string; readonly lineage?: { readonly rootThreadId: string } | null },
>(
  threads: ReadonlyArray<T>,
  workspace: WorkspaceId,
  threadWorkspaces: Readonly<Record<string, string>>,
): ReadonlyArray<T> {
  return threads.filter((thread) => resolveThreadWorkspace(thread, threadWorkspaces) === workspace);
}

export function isSkillInstalled(
  skill: string,
  providers: ReadonlyArray<{ readonly skills: ReadonlyArray<ServerProviderSkill> }>,
): boolean {
  return providers.some((provider) =>
    provider.skills.some((candidate) => candidate.enabled && candidate.name === skill),
  );
}

/** The composer text a new chat in this workspace starts with; empty when the skill is missing. */
export function workspaceSeedPrompt(
  workspace: WorkspaceId,
  providers: ReadonlyArray<{ readonly skills: ReadonlyArray<ServerProviderSkill> }>,
): string {
  const { skill } = workspaceDefinition(workspace);
  return skill !== null && isSkillInstalled(skill, providers) ? `$${skill} ` : "";
}

/** True for text that is only some workspace's seed, which a new chat may replace. */
export function isWorkspaceSeedPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  return WORKSPACES.some(
    (workspace) => workspace.skill !== null && trimmed === `$${workspace.skill}`,
  );
}

/** The thread-to-workspace map after a new chat opens in `workspace`. */
export function assignThreadWorkspace(
  threadWorkspaces: Readonly<Record<string, string>>,
  threadId: string,
  workspace: WorkspaceId,
): Readonly<Record<string, string>> {
  if (workspace === DEFAULT_WORKSPACE_ID) {
    if (!(threadId in threadWorkspaces)) return threadWorkspaces;
    const { [threadId]: _removed, ...rest } = threadWorkspaces;
    return rest;
  }
  if (threadWorkspaces[threadId] === workspace) return threadWorkspaces;
  return { ...threadWorkspaces, [threadId]: workspace };
}
