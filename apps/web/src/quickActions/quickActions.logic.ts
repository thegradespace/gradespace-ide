import type {
  KeybindingCommand,
  KeybindingShortcut,
  QuickAction,
  QuickActionRunIn,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  matchesKeybindingShortcut,
  parseKeybindingShortcut,
  type ShortcutEventLike,
} from "@t3tools/shared/keybindings";

import { formatShortcutLabel, shortcutConflictKey } from "../keybindings";

export const IMPROVE_STEPS = [
  {
    id: "research",
    label: "Research",
    description: "Compare with similar products and current guidance",
    skipLabel: "research",
  },
  {
    id: "review",
    label: "Review the code",
    description: "Product, frontend and backend review",
    skipLabel: "the code review",
  },
  {
    id: "test",
    label: "Test it for real",
    description: "Run it and click through the main flows",
    skipLabel: "real testing",
  },
  {
    id: "words",
    label: "Improve the words",
    description: "Headlines, buttons, empty states, errors",
    skipLabel: "the copy",
  },
  {
    id: "designs",
    label: "Show UI designs in Studio",
    description: "Before and after, you pick",
    skipLabel: "the Studio designs",
  },
  {
    id: "build",
    label: "Build after I approve",
    description: "On a new branch, with checks and QA",
    skipLabel: "the build",
  },
] as const;

export type ImproveStepId = (typeof IMPROVE_STEPS)[number]["id"];
export type ImproveSteps = Readonly<Record<ImproveStepId, boolean>>;

export const ALL_IMPROVE_STEPS: ImproveSteps = {
  research: true,
  review: true,
  test: true,
  words: true,
  designs: true,
  build: true,
};

/** The launcher's message: the action's skill line, then every choice spelled out. */
export function buildImprovePrompt(input: {
  readonly opening: string;
  readonly folder: string;
  readonly focus: string;
  readonly steps: ImproveSteps;
}): string {
  const opening = input.opening.trim() || "$gs-improve";
  const lines = [`${opening} Reassess and improve the project at ${input.folder}.`];
  const focus = input.focus.trim();
  if (focus) lines.push(`Focus: ${focus}`);
  const chosen = IMPROVE_STEPS.filter((step) => step.id !== "build" && input.steps[step.id]);
  if (chosen.length > 0) {
    lines.push("Steps:", ...chosen.map((step) => `- ${step.label}: ${step.description}.`));
  }
  const skipped = IMPROVE_STEPS.filter((step) => step.id !== "build" && !input.steps[step.id]);
  if (skipped.length > 0) {
    lines.push(`Skip: ${skipped.map((step) => step.skipLabel).join(", ")}.`);
  }
  if (input.steps.build) {
    lines.push(
      "Then build what I approve on a new branch, with checks and QA. Stop for my approval before building anything.",
    );
  } else {
    const stopAfter = input.steps.designs ? "the designs" : "the ranked proposals";
    lines.push(`Do not build; stop after ${stopAfter}.`);
  }
  return lines.join("\n");
}

export function otherRunIn(runIn: QuickActionRunIn): QuickActionRunIn {
  return runIn === "new-chat" ? "this-chat" : "new-chat";
}

/** macOS logs out on Cmd+Shift+Q before the app sees it. */
const RESERVED_SHORTCUTS = ["mod+shift+q"];

export function isReservedQuickActionShortcut(value: string, platform: string): boolean {
  const shortcut = parseKeybindingShortcut(value);
  if (!shortcut) return false;
  const key = shortcutConflictKey(shortcut, platform);
  return RESERVED_SHORTCUTS.some((reserved) => {
    const parsed = parseKeybindingShortcut(reserved);
    return parsed !== null && shortcutConflictKey(parsed, platform) === key;
  });
}

function parsedShortcut(action: QuickAction): KeybindingShortcut | null {
  return action.keybinding === null ? null : parseKeybindingShortcut(action.keybinding);
}

export function quickActionShortcutLabel(action: QuickAction): string | null {
  const shortcut = parsedShortcut(action);
  return shortcut ? formatShortcutLabel(shortcut) : null;
}

export function findQuickActionForEvent(
  event: ShortcutEventLike,
  actions: ReadonlyArray<QuickAction>,
  platform: string,
): QuickAction | null {
  for (const action of actions) {
    const shortcut = parsedShortcut(action);
    if (shortcut && matchesKeybindingShortcut(event, shortcut, platform)) return action;
  }
  return null;
}

/** What else answers to an action's key: other actions, then app commands (by command id). */
export function quickActionKeyConflicts(input: {
  readonly actionId: string;
  readonly keybinding: string;
  readonly actions: ReadonlyArray<QuickAction>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly platform: string;
}): {
  readonly actions: ReadonlyArray<QuickAction>;
  readonly commands: ReadonlyArray<KeybindingCommand>;
} {
  const shortcut = parseKeybindingShortcut(input.keybinding);
  if (!shortcut) return { actions: [], commands: [] };
  const key = shortcutConflictKey(shortcut, input.platform);
  const actions = input.actions.filter((action) => {
    if (action.id === input.actionId) return false;
    const other = parsedShortcut(action);
    return other !== null && shortcutConflictKey(other, input.platform) === key;
  });
  const commands = [
    ...new Set(
      input.keybindings
        .filter((rule) => shortcutConflictKey(rule.shortcut, input.platform) === key)
        .map((rule) => rule.command),
    ),
  ];
  return { actions, commands };
}

export function moveQuickAction(
  actions: ReadonlyArray<QuickAction>,
  index: number,
  direction: -1 | 1,
): ReadonlyArray<QuickAction> {
  const target = index + direction;
  if (index < 0 || index >= actions.length || target < 0 || target >= actions.length) {
    return actions;
  }
  const next = [...actions];
  const [moved] = next.splice(index, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
}
