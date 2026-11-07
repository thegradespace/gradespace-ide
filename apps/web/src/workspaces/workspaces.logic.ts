import type { ClientSettings, ServerProviderSkill } from "@t3tools/contracts";
import {
  DEFAULT_WORKSPACE_ID,
  isWorkspaceId,
  presentationStyleLine,
  REVIEW_SKILL,
  reviewerStyleLine,
  WORKSPACE_SEED_LINE_PREFIXES,
  WORKSPACES,
  workspaceDefinition,
  type WorkspaceId,
} from "@t3tools/client-runtime/workspaces";

export {
  DEFAULT_WORKSPACE_ID,
  isWorkspaceId,
  WORKSPACES,
  workspaceDefinition,
  workspaceForCommand,
  type WorkspaceId,
} from "@t3tools/client-runtime/workspaces";

export type WorkspaceSeedSettings = Pick<
  ClientSettings,
  "presentStyle" | "writeMode" | "reviewerStyle"
>;

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

/** The skill a new chat here starts with: Write in Review mode uses gs-review. */
export function workspaceSkill(
  workspace: WorkspaceId,
  settings: Pick<WorkspaceSeedSettings, "writeMode">,
): string | null {
  if (workspace === "write" && settings.writeMode === "review") return REVIEW_SKILL;
  return workspaceDefinition(workspace).skill;
}

function workspaceSeedLine(workspace: WorkspaceId, settings: WorkspaceSeedSettings) {
  if (workspace === "present") return presentationStyleLine(settings.presentStyle);
  if (workspace === "write" && settings.writeMode === "review") {
    return reviewerStyleLine(settings.reviewerStyle);
  }
  return null;
}

/** The composer text a new chat in this workspace starts with; empty when the skill is missing. */
export function workspaceSeedPrompt(
  workspace: WorkspaceId,
  providers: ReadonlyArray<{ readonly skills: ReadonlyArray<ServerProviderSkill> }>,
  settings: WorkspaceSeedSettings,
): string {
  const skill = workspaceSkill(workspace, settings);
  if (skill === null || !isSkillInstalled(skill, providers)) return "";
  const line = workspaceSeedLine(workspace, settings);
  return line === null ? `$${skill} ` : `$${skill}\n${line}\n`;
}

const SEED_SKILLS = new Set([
  ...WORKSPACES.flatMap((workspace) => (workspace.skill === null ? [] : [workspace.skill])),
  REVIEW_SKILL,
]);

/** True for text that is only some workspace's seed, which a new chat may replace. */
export function isWorkspaceSeedPrompt(prompt: string): boolean {
  const [first, ...rest] = prompt
    .trim()
    .split("\n")
    .map((line) => line.trim());
  return (
    first !== undefined &&
    first.startsWith("$") &&
    SEED_SKILLS.has(first.slice(1)) &&
    rest.every((line) => WORKSPACE_SEED_LINE_PREFIXES.some((prefix) => line.startsWith(prefix)))
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
