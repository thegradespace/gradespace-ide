import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_QUICK_ACTIONS,
  MAX_QUICK_ACTIONS,
  type QuickAction,
  type QuickActionBehavior,
  type QuickActionRunIn,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import {
  isReservedQuickActionShortcut,
  moveQuickAction,
  quickActionKeyConflicts,
  quickActionShortcutLabel,
} from "../../quickActions/quickActions.logic";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { commandLabel, keybindingFromKeyboardEvent } from "./KeybindingsSettings.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const RUN_IN_OPTIONS: ReadonlyArray<{ value: QuickActionRunIn; label: string }> = [
  { value: "new-chat", label: "New chat in the current project" },
  { value: "this-chat", label: "This chat" },
];

const BEHAVIOR_OPTIONS: ReadonlyArray<{ value: QuickActionBehavior; label: string }> = [
  { value: "send", label: "Send it" },
  { value: "prefill", label: "Put it in the composer to finish" },
  { value: "improve-launcher", label: "Open the Reassess and improve options" },
];

function newQuickAction(): QuickAction {
  return {
    id: randomUUID(),
    title: "",
    description: "",
    prompt: "",
    keybinding: null,
    runIn: "new-chat",
    behavior: "send",
  };
}

interface EditorState {
  readonly index: number | null;
  readonly draft: QuickAction;
}

export function QuickActionsSettingsPanel({ startNew }: { readonly startNew: boolean }) {
  const navigate = useNavigate();
  const actions = useClientSettings((settings) => settings.quickActions);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // The palette's "New action" link arrives as ?new=true, also while this page is open.
  const [seenStartNew, setSeenStartNew] = useState(false);
  if (startNew !== seenStartNew) {
    setSeenStartNew(startNew);
    if (startNew && actions.length < MAX_QUICK_ACTIONS) {
      setEditor({ index: null, draft: newQuickAction() });
    }
  }
  const save = (quickActions: ReadonlyArray<QuickAction>) => {
    void updateClientSettings({ quickActions });
  };
  const closeEditor = () => {
    setEditor(null);
    if (startNew) void navigate({ to: "/settings/quick-actions", search: {}, replace: true });
  };
  const changed = !Equal.equals(actions, DEFAULT_QUICK_ACTIONS);
  const resetToDefaults = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Reset quick actions?\nYour own actions and edits will be replaced by the defaults.",
      { variant: "destructive" },
    );
    if (confirmed) save(DEFAULT_QUICK_ACTIONS);
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("quick-actions")}
        headerAction={
          <span className="flex items-center gap-1">
            {changed ? (
              <Button size="xs" variant="ghost-muted" onClick={() => void resetToDefaults()}>
                <RotateCcwIcon />
                Reset to defaults
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              disabled={actions.length >= MAX_QUICK_ACTIONS}
              onClick={() => setEditor({ index: null, draft: newQuickAction() })}
            >
              <PlusIcon />
              New action
            </Button>
          </span>
        }
      >
        {actions.length === 0 ? (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
            No quick actions. Add one, or reset to the defaults.
          </p>
        ) : null}
        {actions.map((action, index) => {
          const shortcutLabel = quickActionShortcutLabel(action);
          const name = action.title || "Untitled action";
          return (
            <SettingsRow
              key={action.id}
              className="group py-2"
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-4 shrink-0 text-muted-foreground tabular-nums">
                    {index < 9 ? index + 1 : ""}
                  </span>
                  <span className="min-w-0 truncate">{name}</span>
                </span>
              }
              description={action.description || undefined}
              control={
                <span className="flex items-center gap-1">
                  {shortcutLabel ? <Kbd>{shortcutLabel}</Kbd> : null}
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`Move ${name} up`}
                    disabled={index === 0}
                    onClick={() => save(moveQuickAction(actions, index, -1))}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`Move ${name} down`}
                    disabled={index === actions.length - 1}
                    onClick={() => save(moveQuickAction(actions, index, 1))}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`Edit ${name}`}
                    onClick={() => setEditor({ index, draft: action })}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-destructive"
                    aria-label={`Delete ${name}`}
                    onClick={() => save(actions.filter((candidate) => candidate.id !== action.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </span>
              }
            />
          );
        })}
      </SettingsSection>
      {editor ? (
        <QuickActionEditor
          key={editor.draft.id}
          initial={editor.draft}
          isNew={editor.index === null}
          actions={actions}
          onCancel={closeEditor}
          onSave={(action) => {
            save(
              editor.index === null
                ? [...actions, action]
                : actions.map((candidate) => (candidate.id === action.id ? action : candidate)),
            );
            closeEditor();
          }}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

function QuickActionEditor(props: {
  readonly initial: QuickAction;
  readonly isNew: boolean;
  readonly actions: ReadonlyArray<QuickAction>;
  readonly onCancel: () => void;
  readonly onSave: (action: QuickAction) => void;
}) {
  const id = useId();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [draft, setDraft] = useState(props.initial);
  const [recording, setRecording] = useState(false);
  const platform = navigator.platform;
  const reserved =
    draft.keybinding !== null && isReservedQuickActionShortcut(draft.keybinding, platform);
  const conflicts =
    draft.keybinding === null
      ? { actions: [], commands: [] }
      : quickActionKeyConflicts({
          actionId: draft.id,
          keybinding: draft.keybinding,
          actions: props.actions,
          keybindings,
          platform,
        });
  const conflictNames = [
    ...conflicts.actions.map((action) => action.title || "Untitled action"),
    ...conflicts.commands.map((command) => commandLabel(command)),
  ];
  const canSave = draft.title.trim().length > 0 && !reserved;
  const shortcutLabel = quickActionShortcutLabel(draft);

  const captureShortcut = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setDraft({ ...draft, keybinding: null });
      return;
    }
    const next = keybindingFromKeyboardEvent(event.nativeEvent, platform, {
      layoutCharacter: true,
    });
    if (!next) return;
    setDraft({ ...draft, keybinding: next });
    setRecording(false);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) props.onSave({ ...draft, title: draft.title.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.isNew ? "New quick action" : "Edit quick action"}</DialogTitle>
            <DialogDescription>
              A saved prompt you can run from the quick actions palette or its own shortcut. Type $
              and a skill name to use a skill.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-title`}>Title</Label>
              <Input
                id={`${id}-title`}
                value={draft.title}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-description`}>Description</Label>
              <Input
                id={`${id}-description`}
                value={draft.description}
                maxLength={200}
                onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-prompt`}>Prompt</Label>
              <Textarea
                id={`${id}-prompt`}
                value={draft.prompt}
                maxLength={20_000}
                size="lg"
                placeholder="$gs-qa Test the checkout flow end to end."
                onChange={(event) => setDraft({ ...draft, prompt: event.currentTarget.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-run-in`}>Runs in</Label>
                <Select
                  value={draft.runIn}
                  onValueChange={(value) => {
                    const option = RUN_IN_OPTIONS.find((candidate) => candidate.value === value);
                    if (option) setDraft({ ...draft, runIn: option.value });
                  }}
                >
                  <SelectTrigger id={`${id}-run-in`} size="sm">
                    <SelectValue>
                      {RUN_IN_OPTIONS.find((option) => option.value === draft.runIn)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {RUN_IN_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-behavior`}>When run</Label>
                <Select
                  value={draft.behavior}
                  onValueChange={(value) => {
                    const option = BEHAVIOR_OPTIONS.find((candidate) => candidate.value === value);
                    if (option) setDraft({ ...draft, behavior: option.value });
                  }}
                >
                  <SelectTrigger id={`${id}-behavior`} size="sm">
                    <SelectValue>
                      {BEHAVIOR_OPTIONS.find((option) => option.value === draft.behavior)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {BEHAVIOR_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-shortcut`}>Shortcut</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-shortcut`}
                  data-keybinding-capture=""
                  readOnly
                  size="sm"
                  font="mono"
                  value={recording ? "" : (shortcutLabel ?? "")}
                  placeholder={recording ? "Press shortcut" : "None"}
                  onFocus={() => setRecording(true)}
                  onBlur={() => setRecording(false)}
                  onKeyDown={captureShortcut}
                />
                {draft.keybinding !== null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft({ ...draft, keybinding: null })}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              {reserved ? (
                <p className="text-destructive-foreground text-xs">
                  That shortcut belongs to the system. Choose another.
                </p>
              ) : conflictNames.length > 0 ? (
                <p className="text-warning text-xs">
                  Also used by {conflictNames.join(", ")}. This action takes it.
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
