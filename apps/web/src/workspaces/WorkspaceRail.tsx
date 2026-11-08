import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouter, type AnyRouter } from "@tanstack/react-router";
import { LibraryIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { getClientSettings } from "../hooks/useSettings";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { shortcutLabelForCommand } from "../keybindings";
import { cn } from "../lib/utils";
import { registerCommands } from "../shortcuts/dispatcher";
import { readThreadShell, useQuietThreadShell } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { WORKSPACE_ICONS } from "./workspaceIcons";
import {
  readActiveWorkspace,
  readThreadWorkspaces,
  setActiveWorkspace,
  useActiveWorkspace,
  useThreadWorkspaces,
} from "./workspaceStore";
import {
  resolveThreadWorkspace,
  WORKSPACES,
  workspaceForCommand,
  type WorkspaceId,
} from "./workspaces.logic";

function readRouteThreadWorkspace(router: AnyRouter): WorkspaceId | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const threadWorkspaces = readThreadWorkspaces();
  if (target?.kind === "server") {
    const shell = readThreadShell(target.threadRef);
    return resolveThreadWorkspace(shell ?? { id: target.threadRef.threadId }, threadWorkspaces);
  }
  if (target?.kind === "draft") {
    const session = useComposerDraftStore.getState().getDraftSession(target.draftId);
    return session ? resolveThreadWorkspace({ id: session.threadId }, threadWorkspaces) : null;
  }
  return null;
}

/** Leaves a chat from another workspace for a fresh draft in this one. */
function switchWorkspace(router: AnyRouter, workspace: WorkspaceId): void {
  if (!getClientSettings().workspaceRailEnabled) return;
  const changed = readActiveWorkspace() !== workspace;
  setActiveWorkspace(workspace);
  if (changed && readRouteThreadWorkspace(router) !== workspace) {
    void router.navigate({ to: "/" });
  }
}

function isKeybindingCaptureTarget(event: KeyboardEvent) {
  return event.target instanceof Element && event.target.closest("[data-keybinding-capture]");
}

function installWorkspaceCommands(router: AnyRouter): () => void {
  const handlers = Object.fromEntries(
    WORKSPACES.map((workspace) => [
      workspace.command,
      (event: KeyboardEvent) => {
        if (!getClientSettings().workspaceRailEnabled) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        switchWorkspace(router, workspaceForCommand(workspace.command) ?? "code");
      },
    ]),
  );
  return registerCommands(handlers, {
    capture: true,
    when: (event) => !event.isComposing && !isKeybindingCaptureTarget(event),
  });
}

/** Opening a chat from another workspace, from history, search or a link, moves the rail there. */
function useFollowRouteWorkspace() {
  const routeTarget = useThreadRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const shell = useQuietThreadShell(routeThreadRef);
  const threadWorkspaces = useThreadWorkspaces();
  const routeWorkspace =
    routeThreadRef === null
      ? null
      : resolveThreadWorkspace(shell ?? { id: routeThreadRef.threadId }, threadWorkspaces);
  const routeKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}`
    : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the opened chat's workspace to the persisted rail selection when the route changes
  useEffect(() => {
    if (routeKey === null || routeWorkspace === null) return;
    if (readActiveWorkspace() !== routeWorkspace && getClientSettings().workspaceRailEnabled) {
      setActiveWorkspace(routeWorkspace);
    }
  }, [routeKey, routeWorkspace]);
}

function RailButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string | null | undefined;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-current={active ? "page" : undefined}
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onClick}
            className={cn(
              "relative flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-hidden ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-inset [-webkit-app-region:no-drag]",
              active
                ? "bg-sidebar-row-active text-foreground"
                : disabled
                  ? "cursor-default opacity-35"
                  : "hover:bg-sidebar-row-hover hover:text-foreground",
            )}
          />
        }
      >
        {active ? (
          <span
            aria-hidden
            className="absolute top-2.5 -left-2.5 h-5 w-[3px] rounded-full bg-workspace-marker"
          />
        ) : null}
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">
        {label}
        {shortcut ? <span className="ml-2 text-muted-foreground">{shortcut}</span> : null}
      </TooltipPopup>
    </Tooltip>
  );
}

export function WorkspaceRail() {
  const router = useRouter();
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const active = useActiveWorkspace();
  useFollowRouteWorkspace();
  // Created once so re-renders never re-register the commands.
  const [commandsRef] = useState(
    () => (node: HTMLElement | null) =>
      node === null ? undefined : installWorkspaceCommands(router),
  );

  return (
    <nav
      ref={commandsRef}
      aria-label="Workspaces"
      data-workspace-rail=""
      className="fixed inset-y-0 left-0 z-20 hidden w-(--workspace-rail-width) flex-col items-center gap-1.5 bg-background pt-(--workspace-topbar-height) pb-3.5 after:absolute after:top-(--workspace-topbar-height) after:right-0 after:bottom-0 after:w-px after:bg-sidebar-border md:flex"
    >
      {WORKSPACES.map((workspace) => {
        const Icon = WORKSPACE_ICONS[workspace.id];
        return (
          <RailButton
            key={workspace.id}
            label={workspace.label}
            shortcut={shortcutLabelForCommand(keybindings, workspace.command)}
            active={active === workspace.id}
            onClick={() => switchWorkspace(router, workspace.id)}
          >
            <Icon className="size-[19px]" strokeWidth={1.7} />
          </RailButton>
        );
      })}
      <div aria-hidden className="my-1.5 h-px w-6.5 shrink-0 bg-border" />
      <RailButton label="Library" onClick={() => void navigate({ to: "/library" })}>
        <LibraryIcon className="size-[19px]" strokeWidth={1.7} />
      </RailButton>
      <div className="flex-1" />
      <RailButton label="Settings" onClick={() => void navigate({ to: "/settings" })}>
        <SettingsIcon className="size-[19px]" strokeWidth={1.7} />
      </RailButton>
    </nav>
  );
}

/** The rail's workspaces as a row, for the phone sidebar where the rail does not fit. */
export function WorkspaceSwitcherRow() {
  const router = useRouter();
  const active = useActiveWorkspace();
  return (
    <nav aria-label="Workspaces" className="flex items-center justify-between px-1 pb-1 md:hidden">
      {WORKSPACES.map((workspace) => {
        const Icon = WORKSPACE_ICONS[workspace.id];
        return (
          <button
            key={workspace.id}
            type="button"
            aria-label={workspace.label}
            aria-current={active === workspace.id ? "page" : undefined}
            onClick={() => switchWorkspace(router, workspace.id)}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg text-muted-foreground",
              active === workspace.id && "bg-sidebar-row-active text-foreground",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.7} />
          </button>
        );
      })}
    </nav>
  );
}
