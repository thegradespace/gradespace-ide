import type {
  ClientSettings,
  PresentationStyleChoice,
  ReviewerStyleId,
  ServerProviderSkill,
  WorkspaceKeybindingCommand,
} from "@t3tools/contracts";

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

/** Write's Review mode starts chats with this skill instead of its own. */
const REVIEW_SKILL = "gs-review";

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

// Values mirror gs-present's styles.md, which reads the line these build.
export interface PresentationStyle {
  readonly name: string;
  readonly description: string;
  readonly background: string;
  readonly text: string;
  readonly accent: string;
  readonly second: string;
  readonly headingFont: string;
  readonly bodyFont: string;
}

export const PRESENTATION_STYLES: ReadonlyArray<PresentationStyle> = [
  {
    name: "Gradespace",
    description: "Calm and spacious, in the Gradespace brand.",
    background: "#F6F7FB",
    text: "#14162B",
    accent: "#241AD0",
    second: "#F5A524",
    headingFont: "Jost",
    bodyFont: "Figtree",
  },
  {
    name: "Modern",
    description: "Clean grid and big numbers, for pitches and products.",
    background: "#FFFFFF",
    text: "#0E1111",
    accent: "#0F9D8A",
    second: "#0E1111",
    headingFont: "Helvetica Neue",
    bodyFont: "Helvetica Neue",
  },
  {
    name: "Bold",
    description: "Dark, loud and few words, for talks that grab a room.",
    background: "#111018",
    text: "#FFFFFF",
    accent: "#FF5A4E",
    second: "#FFD23F",
    headingFont: "Avenir Next Condensed",
    bodyFont: "Avenir Next",
  },
  {
    name: "Classic",
    description: "Serif and calm pacing, for boards, funders and policy.",
    background: "#FBF8F1",
    text: "#1F2A24",
    accent: "#1E5A43",
    second: "#B08A3E",
    headingFont: "Georgia",
    bodyFont: "Georgia",
  },
  {
    name: "Minimal",
    description: "One line per slide, for keynotes the speaker carries.",
    background: "#FFFFFF",
    text: "#111111",
    accent: "#111111",
    second: "#BBBBBB",
    headingFont: "Helvetica Neue Light",
    bodyFont: "Helvetica Neue",
  },
  {
    name: "Academic",
    description: "Numbered figures and sources, for conferences and vivas.",
    background: "#FFFFFF",
    text: "#16213A",
    accent: "#1D3A6E",
    second: "#A23B3B",
    headingFont: "Charter",
    bodyFont: "Charter",
  },
];

/** Fonts the Adjust pickers offer besides the preset's own. */
export const COMMON_PRESENTATION_FONTS = [
  "Inter",
  "Helvetica Neue",
  "Avenir Next",
  "Futura",
  "Jost",
  "Figtree",
  "Georgia",
  "Charter",
  "Garamond",
  "Arial",
] as const;

export function presentationStyle(name: string): PresentationStyle | null {
  return PRESENTATION_STYLES.find((style) => style.name === name) ?? null;
}

/** The preset with the choice's overrides applied; null when the preset is unknown. */
export function resolvePresentationStyle(
  choice: PresentationStyleChoice,
): PresentationStyle | null {
  const preset = presentationStyle(choice.name);
  if (preset === null) return null;
  return {
    ...preset,
    accent: choice.accent ?? preset.accent,
    second: choice.second ?? preset.second,
    background: choice.background ?? preset.background,
    headingFont: choice.headingFont ?? preset.headingFont,
    bodyFont: choice.bodyFont ?? preset.bodyFont,
  };
}

const sameValue = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `Style: Bold · accent #FF0000`, naming only what differs from the preset. */
export function presentationStyleLine(choice: PresentationStyleChoice | null): string | null {
  if (choice === null) return null;
  const preset = presentationStyle(choice.name);
  if (preset === null) return null;
  const parts = [`Style: ${preset.name}`];
  const add = (label: string, value: string | undefined, presetValue: string, hex: boolean) => {
    if (value === undefined || value.trim() === "" || sameValue(value, presetValue)) return;
    parts.push(`${label} ${hex ? value.trim().toUpperCase() : value.trim()}`);
  };
  add("accent", choice.accent, preset.accent, true);
  add("second", choice.second, preset.second, true);
  add("heading font", choice.headingFont, preset.headingFont, false);
  add("body font", choice.bodyFont, preset.bodyFont, false);
  add("background", choice.background, preset.background, true);
  return parts.join(" · ");
}

export interface ReviewerStyle {
  readonly id: ReviewerStyleId;
  readonly label: string;
  readonly description: string;
}

export const REVIEWER_STYLES: ReadonlyArray<ReviewerStyle> = [
  { id: "calm", label: "Calm", description: "A supportive senior colleague" },
  { id: "balanced", label: "Balanced", description: "A fair, typical journal referee" },
  { id: "harsh", label: "Harsh", description: "Reviewer 2: hostile but fair" },
  {
    id: "editor-triage",
    label: "Editor triage",
    description: "The editor's first five minutes: scope, compliance, desk-reject risk",
  },
];

export function reviewerStyle(id: ReviewerStyleId): ReviewerStyle {
  return REVIEWER_STYLES.find((style) => style.id === id) ?? REVIEWER_STYLES[1]!;
}

export function reviewerStyleLine(id: ReviewerStyleId): string {
  return `Reviewer style: ${reviewerStyle(id).label}`;
}

/** Prefixes of the lines a workspace adds under its skill, so a seed stays recognisable. */
const WORKSPACE_SEED_LINE_PREFIXES = ["Style: ", "Reviewer style: "] as const;

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
