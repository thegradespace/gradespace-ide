import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link, useNavigate, useParams } from "@tanstack/react-router";

import { cn } from "~/lib/utils";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const RAIL_THREAD_LIMIT = 30;

/** Shows the rail while the desktop sidebar is collapsed; mobile keeps its sheet. */
export function SidebarCollapsedRailSlot() {
  const { state, isMobile } = useSidebar();
  return state === "collapsed" && !isMobile ? <SidebarCollapsedRail /> : null;
}

/** Recent threads as project icons, shown in place of the collapsed sidebar. */
function SidebarCollapsedRail() {
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const railThreads = threads
    .filter((thread) => thread.archivedAt === null && thread.settledOverride !== "settled")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RAIL_THREAD_LIMIT);

  return (
    <nav
      aria-label="Recent threads"
      className="flex h-svh w-(--sidebar-rail-width) shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar"
    >
      {/* Room for the fixed sidebar toggle above the threads. */}
      <div
        aria-hidden
        className="mt-(--workspace-controls-top) h-(--workspace-topbar-height) shrink-0"
      />
      <Link
        to="/"
        aria-label="Gradespace home"
        className="flex size-9 shrink-0 items-center justify-center rounded-md outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset"
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
        {railThreads.map((thread) => {
          const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
          const active =
            params.environmentId === thread.environmentId && params.threadId === thread.id;
          const needsAttention = thread.hasPendingApprovals || thread.hasPendingUserInput;
          return (
            <Tooltip key={`${thread.environmentId}:${thread.id}`}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={thread.title}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex size-9 shrink-0 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-row-hover",
                      active && "bg-sidebar-row-active",
                    )}
                    onClick={() =>
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(
                          scopeThreadRef(thread.environmentId, thread.id),
                        ),
                      })
                    }
                  >
                    {project ? (
                      <ProjectFavicon project={project} className="size-5" />
                    ) : (
                      <span className="text-xs font-medium">
                        {thread.title.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    {needsAttention ? (
                      <span
                        aria-hidden
                        className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
                      />
                    ) : null}
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
      </div>
    </nav>
  );
}
