import { useAtomValue } from "@effect/atom-react";
import type { QuickAction, QuickActionRunIn, ScopedProjectRef } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { PlusIcon, ZapIcon } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Kbd, KbdGroup } from "../components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Textarea } from "../components/ui/textarea";
import { createNewThreadHandler, useHandleNewThread } from "../hooks/useHandleNewThread";
import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { shortcutLabelForCommand } from "../keybindings";
import { resolveThreadActionProjectRef } from "../lib/chatThreadActions";
import { isTerminalFocused } from "../lib/terminalFocus";
import { cn, isMacPlatform } from "../lib/utils";
import { registerCommands } from "../shortcuts/dispatcher";
import { readProject, useProjects } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  ALL_IMPROVE_STEPS,
  buildImprovePrompt,
  findQuickActionForEvent,
  IMPROVE_STEPS,
  type ImproveSteps,
  otherRunIn,
  quickActionShortcutLabel,
} from "./quickActions.logic";
import {
  closeImproveLauncher,
  setQuickActionsPaletteOpen,
  useQuickActionsStore,
} from "./quickActionsStore";
import { runQuickAction, runQuickActionPrompt } from "./runQuickAction";

const RUN_IN_LABELS: Record<QuickActionRunIn, string> = {
  "new-chat": "new chat",
  "this-chat": "this chat",
};

function isKeybindingCaptureTarget(event: KeyboardEvent) {
  return event.target instanceof Element && event.target.closest("[data-keybinding-capture]");
}

/** The rich-text composer keeps Mod+I for italics while text is selected. */
function isItalicSelectionTarget(event: KeyboardEvent) {
  const selection = window.getSelection();
  return (
    selection !== null &&
    !selection.isCollapsed &&
    event.target instanceof Element &&
    event.target.closest('[data-composer-rich-text="true"]') !== null
  );
}

function isInsideOtherDialog(event: KeyboardEvent) {
  return (
    event.target instanceof Element &&
    event.target.closest('[role="dialog"]:not([data-quick-actions-palette])') !== null
  );
}

function installQuickActionCommands(router: ReturnType<typeof useRouter>): () => void {
  const deps = { router, handleNewThread: createNewThreadHandler(router) };
  const disposeOpen = registerCommands(
    {
      "quickActions.open": (event) => {
        if (isItalicSelectionTarget(event)) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        setQuickActionsPaletteOpen(!useQuickActionsStore.getState().paletteOpen);
      },
    },
    // Capture phase, ahead of the composer's own Mod+I.
    { capture: true, when: (event) => !isKeybindingCaptureTarget(event) },
  );
  const disposeActions = registerCommands(
    {},
    {
      capture: true,
      when: (event) =>
        !event.isComposing &&
        !isKeybindingCaptureTarget(event) &&
        !isInsideOtherDialog(event) &&
        !isTerminalFocused(),
      onKeyDown: (event) => {
        const action = findQuickActionForEvent(
          event,
          getClientSettings().quickActions,
          navigator.platform,
        );
        if (action === null) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        setQuickActionsPaletteOpen(false);
        void runQuickAction(action, action.runIn, deps);
      },
    },
  );
  return () => {
    disposeOpen();
    disposeActions();
  };
}

export function QuickActionsHost() {
  const router = useRouter();
  const paletteOpen = useQuickActionsStore((state) => state.paletteOpen);
  const launcher = useQuickActionsStore((state) => state.launcher);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the quick action shortcuts with the window keydown dispatcher
  useEffect(() => installQuickActionCommands(router), [router]);
  return (
    <>
      <Dialog open={paletteOpen} onOpenChange={setQuickActionsPaletteOpen}>
        {paletteOpen ? <QuickActionsPalette /> : null}
      </Dialog>
      {launcher ? (
        <ImproveLauncher
          key={`${launcher.actionId}:${launcher.projectRef.projectId}`}
          actionId={launcher.actionId}
          initialProjectRef={launcher.projectRef}
        />
      ) : null}
    </>
  );
}

function QuickActionsPalette() {
  const router = useRouter();
  const navigate = useNavigate();
  const listId = useId();
  const actions = useClientSettings((settings) => settings.quickActions);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const projectRef = resolveThreadActionProjectRef({
    activeDraftThread,
    activeThread: activeThread ?? undefined,
    defaultProjectRef,
    handleNewThread,
  });
  const projectTitle = projectRef ? readProject(projectRef)?.title : undefined;
  const [highlighted, setHighlighted] = useState(0);
  const highlightedIndex = Math.min(highlighted, Math.max(actions.length - 1, 0));
  const highlightedAction = actions[highlightedIndex];
  const mac = isMacPlatform(navigator.platform);
  const openLabel = shortcutLabelForCommand(keybindings, "quickActions.open");

  const run = (action: QuickAction, alternate: boolean) => {
    setQuickActionsPaletteOpen(false);
    void runQuickAction(action, alternate ? otherRunIn(action.runIn) : action.runIn, {
      router,
      handleNewThread,
    });
  };
  const openSettings = (newAction: boolean) => {
    setQuickActionsPaletteOpen(false);
    void navigate({ to: "/settings/quick-actions", search: newAction ? { new: true } : {} });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || actions.length === 0) return;
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
    if (digit !== undefined && !event.metaKey && !event.ctrlKey) {
      const action = actions[Number(digit) - 1];
      if (action) {
        event.preventDefault();
        run(action, event.altKey);
      }
      return;
    }
    const move = (index: number) => {
      event.preventDefault();
      setHighlighted((index + actions.length) % actions.length);
    };
    if (event.key === "ArrowDown") move(highlightedIndex + 1);
    else if (event.key === "ArrowUp") move(highlightedIndex - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(actions.length - 1);
    else if (event.key === "Enter" && highlightedAction) {
      event.preventDefault();
      run(highlightedAction, event.altKey);
    }
  };

  return (
    <DialogPopup
      data-quick-actions-palette=""
      aria-label="Quick actions"
      showCloseButton={false}
      bottomStickOnMobile={false}
      className="sm:max-w-xl"
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <ZapIcon className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-semibold text-base">Quick actions</h2>
        {projectTitle ? (
          <span className="min-w-0 truncate text-muted-foreground text-sm">in {projectTitle}</span>
        ) : null}
        {openLabel ? <Kbd className="ms-auto">{openLabel}</Kbd> : null}
      </div>
      <div
        role="listbox"
        id={listId}
        aria-label="Quick actions"
        aria-activedescendant={highlightedAction ? `${listId}-${highlightedAction.id}` : undefined}
        tabIndex={0}
        autoFocus
        onKeyDown={onKeyDown}
        className="max-h-[min(28rem,60vh)] overflow-y-auto p-2 outline-none"
      >
        {actions.length === 0 ? (
          <p className="px-2 py-6 text-center text-muted-foreground text-sm">
            No quick actions yet.
          </p>
        ) : null}
        {actions.map((action, index) => {
          const shortcutLabel = quickActionShortcutLabel(action);
          return (
            <div
              key={action.id}
              id={`${listId}-${action.id}`}
              role="option"
              aria-selected={index === highlightedIndex}
              onMouseMove={() => setHighlighted(index)}
              onClick={(event) => run(action, event.altKey)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2",
                index === highlightedIndex && "bg-accent text-accent-foreground",
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-medium text-muted-foreground text-xs tabular-nums">
                {index < 9 ? index + 1 : ""}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-sm">
                  {action.title || "Untitled action"}
                </span>
                {action.description ? (
                  <span className="truncate text-muted-foreground text-xs">
                    {action.description}
                  </span>
                ) : null}
              </span>
              {shortcutLabel ? <Kbd>{shortcutLabel}</Kbd> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5 text-muted-foreground text-xs">
        {highlightedAction ? (
          <>
            <KbdGroup>
              <Kbd>⏎</Kbd>
              <span>{RUN_IN_LABELS[highlightedAction.runIn]}</span>
            </KbdGroup>
            <KbdGroup>
              <Kbd>{mac ? "⌥⏎" : "Alt+Enter"}</Kbd>
              <span>{RUN_IN_LABELS[otherRunIn(highlightedAction.runIn)]}</span>
            </KbdGroup>
          </>
        ) : null}
        <Button size="xs" variant="ghost-muted" onClick={() => openSettings(false)}>
          Edit actions
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          className="ms-auto"
          onClick={() => openSettings(true)}
        >
          <PlusIcon />
          New action
        </Button>
      </div>
    </DialogPopup>
  );
}

function ImproveLauncher(props: {
  readonly actionId: string;
  readonly initialProjectRef: ScopedProjectRef;
}) {
  const focusId = useId();
  const action = useClientSettings((settings) =>
    settings.quickActions.find((candidate) => candidate.id === props.actionId),
  );
  const projects = useProjects();
  const { handleNewThread } = useHandleNewThread();
  const [projectRef, setProjectRef] = useState(props.initialProjectRef);
  const [focus, setFocus] = useState("");
  const [steps, setSteps] = useState<ImproveSteps>(ALL_IMPROVE_STEPS);
  const project = projects.find(
    (candidate) =>
      candidate.id === projectRef.projectId && candidate.environmentId === projectRef.environmentId,
  );
  const otherProjects = projects.filter(
    (candidate) => candidate.isScratch !== true && !candidate.archivedAt && candidate !== project,
  );
  const shortcutLabel = action ? quickActionShortcutLabel(action) : null;
  const mac = isMacPlatform(navigator.platform);

  const start = () => {
    if (!project) return;
    closeImproveLauncher();
    void runQuickActionPrompt({
      text: buildImprovePrompt({
        opening: action?.prompt ?? "$gs-improve",
        folder: project.workspaceRoot,
        focus,
        steps,
      }),
      behavior: "send",
      runIn: "new-chat",
      projectRef,
      handleNewThread,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeImproveLauncher();
      }}
    >
      <DialogPopup
        showCloseButton={false}
        className="sm:max-w-2xl"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            start();
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{action?.title || "Reassess and improve"}</DialogTitle>
            {shortcutLabel ? <Kbd>{shortcutLabel}</Kbd> : null}
          </div>
          <DialogDescription>
            Runs in a new chat and stops for your approval before building.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Folder</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {project?.workspaceRoot ?? "Project not found"}
            </span>
            <Menu>
              <MenuTrigger
                render={<Button size="xs" variant="ghost" disabled={otherProjects.length === 0} />}
              >
                Change
              </MenuTrigger>
              <MenuPopup align="end">
                {otherProjects.map((candidate) => (
                  <MenuItem
                    key={`${candidate.environmentId}:${candidate.id}`}
                    onClick={() =>
                      setProjectRef({
                        environmentId: candidate.environmentId,
                        projectId: candidate.id,
                      })
                    }
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{candidate.title}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {candidate.workspaceRoot}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
          <label htmlFor={focusId} className="sr-only">
            Focus (optional)
          </label>
          <Textarea
            id={focusId}
            value={focus}
            onChange={(event) => setFocus(event.currentTarget.value)}
            placeholder='Focus (optional): e.g. "the onboarding and pricing page"'
          />
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {IMPROVE_STEPS.map((step) => (
              <label key={step.id} className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  checked={steps[step.id]}
                  onCheckedChange={(checked) => setSteps({ ...steps, [step.id]: checked === true })}
                />
                <span className="flex flex-col">
                  <span className="text-sm">{step.label}</span>
                  <span className="text-muted-foreground text-xs">{step.description}</span>
                </span>
              </label>
            ))}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={closeImproveLauncher}>
            Cancel
          </Button>
          <Button disabled={!project} onClick={start}>
            Start
            <span className="text-xs opacity-72">{mac ? "⌘⏎" : "Ctrl+Enter"}</span>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
