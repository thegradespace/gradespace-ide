import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { SidebarCollapsedStyle } from "@t3tools/contracts/settings";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const RAIL_THREAD_LIMIT = 30;
const TAB_THREAD_LIMIT = 12;
const EDGE_PEEK_CLOSE_DELAY_MS = 200;

type Project = ReturnType<typeof useProjects>[number];

/** Hover state for the edge peek; the delay lets the pointer cross into menus the sidebar opens. */
export function useEdgePeek() {
  const [peeking, setPeeking] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  return {
    peeking,
    show: () => {
      cancelClose();
      setPeeking(true);
    },
    hide: () => {
      cancelClose();
      closeTimer.current = setTimeout(() => setPeeking(false), EDGE_PEEK_CLOSE_DELAY_MS);
    },
  };
}

/** Shows the chosen style while the desktop sidebar is collapsed; mobile keeps its sheet. */
export function SidebarCollapsedSlot(props: {
  readonly style: SidebarCollapsedStyle;
  readonly onEdgeEnter: () => void;
}) {
  const { state, isMobile } = useSidebar();
  if (state !== "collapsed" || isMobile) return null;
  switch (props.style) {
    case "project-dock":
      return <ProjectDock />;
    case "slim-rail":
      return <SlimRail />;
    case "thread-tabs":
      return <ThreadTabs />;
    case "edge-peek":
      return (
        <div
          aria-hidden
          data-collapsed-edge=""
          className="fixed inset-y-0 left-(--workspace-rail-width) z-30 w-1.5 border-r border-sidebar-border bg-sidebar"
          onPointerEnter={props.onEdgeEnter}
        />
      );
  }
}

function useOpenThreads() {
  return useQuietThreadShells()
    .filter((thread) => thread.archivedAt === null && thread.settledOverride !== "settled")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function useProjectLookup() {
  const projects = useProjects();
  const byKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  return (thread: EnvironmentThreadShell) =>
    byKey.get(`${thread.environmentId}:${thread.projectId}`);
}

function useThreadNavigation() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  return {
    isActive: (thread: EnvironmentThreadShell) =>
      params.environmentId === thread.environmentId && params.threadId === thread.id,
    open: (thread: EnvironmentThreadShell) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      }),
  };
}

function needsAttention(thread: EnvironmentThreadShell) {
  return thread.hasPendingApprovals || thread.hasPendingUserInput;
}

function ThreadStatusDot({
  thread,
  className,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly className?: string;
}) {
  const status = resolveThreadStatusPill({ thread });
  if (status === null) return null;
  return <span aria-hidden className={cn("size-1.5 rounded-full", status.dotClass, className)} />;
}

function RailFrame({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className="flex h-svh w-(--sidebar-rail-width) shrink-0 flex-col items-center bg-background"
    >
      {/* The window controls and sidebar toggle sit here and continue into the page header. */}
      <div
        aria-hidden
        className={cn(
          "mt-(--workspace-controls-top) h-(--workspace-topbar-height) w-full shrink-0",
          isElectron && "drag-region",
        )}
      />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center border-t border-r border-sidebar-border bg-sidebar">
        <Link
          to="/"
          aria-label="Gradespace home"
          className="mt-2 flex size-9 shrink-0 items-center justify-center rounded-md outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset"
        >
          <img
            src="/brand/gradespace-ide-small.svg"
            alt=""
            width={28}
            height={28}
            className="size-7"
          />
        </Link>
        <div className="scrollbar-gutter-both flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
          {children}
        </div>
      </div>
    </nav>
  );
}

const RAIL_BUTTON_CLASS =
  "relative flex size-9 shrink-0 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-row-hover";

function ThreadIcon({
  project,
  thread,
}: {
  readonly project: Project | undefined;
  readonly thread: EnvironmentThreadShell;
}) {
  return project ? (
    <ProjectFavicon project={project} className="size-5" />
  ) : (
    <span className="text-xs font-medium">{thread.title.slice(0, 2).toUpperCase()}</span>
  );
}

/** Recent threads as project icons, with each thread's activity. */
function SlimRail() {
  const threads = useOpenThreads().slice(0, RAIL_THREAD_LIMIT);
  const projectOf = useProjectLookup();
  const navigation = useThreadNavigation();
  return (
    <RailFrame label="Recent threads">
      {threads.map((thread) => {
        const project = projectOf(thread);
        const active = navigation.isActive(thread);
        return (
          <Tooltip key={`${thread.environmentId}:${thread.id}`}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={thread.title}
                  aria-current={active ? "page" : undefined}
                  className={cn(RAIL_BUTTON_CLASS, active && "bg-sidebar-row-active")}
                  onClick={() => navigation.open(thread)}
                >
                  <ThreadIcon project={project} thread={thread} />
                  <ThreadStatusDot thread={thread} className="absolute top-1 right-1" />
                </button>
              }
            />
            <TooltipPopup side="right">
              <span className="flex flex-col">
                <span>{thread.title}</span>
                {project ? <span className="text-muted-foreground">{project.title}</span> : null}
              </span>
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </RailFrame>
  );
}

/** One icon per project with open threads; hovering lists that project's threads. */
function ProjectDock() {
  const threads = useOpenThreads();
  const projectOf = useProjectLookup();
  const navigation = useThreadNavigation();
  const groups = new Map<string, Array<EnvironmentThreadShell>>();
  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const group = groups.get(key);
    if (group) group.push(thread);
    else groups.set(key, [thread]);
  }
  return (
    <RailFrame label="Projects">
      {Array.from(groups, ([key, projectThreads]) => {
        const [latest] = projectThreads;
        if (!latest) return null;
        const project = projectOf(latest);
        const title = project?.title ?? latest.title;
        const active = projectThreads.some(navigation.isActive);
        return (
          <Popover key={key}>
            <PopoverTrigger
              openOnHover
              delay={100}
              closeDelay={150}
              render={
                <button
                  type="button"
                  aria-label={`${title}, ${projectThreads.length} open threads`}
                  className={cn(RAIL_BUTTON_CLASS, active && "bg-sidebar-row-active")}
                  onClick={() => navigation.open(latest)}
                >
                  <ThreadIcon project={project} thread={latest} />
                  <span className="absolute -right-0.5 -bottom-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-4xs leading-none font-medium tabular-nums text-sidebar-foreground">
                    {projectThreads.length > 99 ? "99+" : projectThreads.length}
                  </span>
                  {projectThreads.some(needsAttention) ? (
                    <span
                      aria-hidden
                      className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
                    />
                  ) : null}
                </button>
              }
            />
            <PopoverPopup side="right" align="start" padding="none" className="w-64">
              <div className="truncate px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {title}
              </div>
              <div className="flex max-h-80 flex-col overflow-y-auto p-1">
                {projectThreads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    aria-current={navigation.isActive(thread) ? "page" : undefined}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                      navigation.isActive(thread) && "bg-accent",
                    )}
                    onClick={() => navigation.open(thread)}
                  >
                    <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                    <ThreadStatusDot thread={thread} className="shrink-0" />
                  </button>
                ))}
              </div>
            </PopoverPopup>
          </Popover>
        );
      })}
    </RailFrame>
  );
}

/** Recent threads as tabs in a bar above the page, beside the window controls and toggle. */
function ThreadTabs() {
  const recent = useOpenThreads();
  const projectOf = useProjectLookup();
  const navigation = useThreadNavigation();
  const tabs = recent.slice(0, TAB_THREAD_LIMIT);
  const activeThread = recent.find(navigation.isActive);
  if (activeThread && !tabs.includes(activeThread)) tabs[tabs.length - 1] = activeThread;
  return (
    <nav
      aria-label="Thread tabs"
      data-collapsed-tabs=""
      className={cn(
        "fixed top-0 right-0 left-(--workspace-rail-width) z-40 flex h-(--workspace-topbar-height) items-center gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar pr-3",
        isElectron && "drag-region",
      )}
    >
      {tabs.map((thread) => {
        const project = projectOf(thread);
        const active = navigation.isActive(thread);
        return (
          <Tooltip key={`${thread.environmentId}:${thread.id}`}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-8 max-w-48 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-sidebar-foreground hover:bg-sidebar-row-hover",
                    active && "bg-sidebar-row-active",
                  )}
                  onClick={() => navigation.open(thread)}
                >
                  {project ? (
                    <ProjectFavicon project={project} className="size-4 shrink-0" />
                  ) : null}
                  <span className="min-w-0 truncate">{thread.title}</span>
                  <ThreadStatusDot thread={thread} className="shrink-0" />
                </button>
              }
            />
            <TooltipPopup side="bottom">
              <span className="flex flex-col">
                <span>{thread.title}</span>
                {project ? <span className="text-muted-foreground">{project.title}</span> : null}
              </span>
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </nav>
  );
}
