import { CircleDashedIcon } from "lucide-react";
import type { ReactNode } from "react";
import { attachSidebarTree } from "../../lib/sidebarTree";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

const attachDockTree = (node: HTMLUListElement | null) => attachSidebarTree(node);

/** Working threads pinned above the sidebar footer, outside the scrolling list. */
export function SidebarWorkingDock(props: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="sidebar-working-dock"
      className="mx-(--sidebar-content-inset) mb-(--sidebar-content-inset) flex max-h-[40vh] shrink-0 flex-col overflow-hidden rounded-lg border border-info/25 bg-info/6"
    >
      <div className="shrink-0 px-1 pt-0.5">
        <CollapsibleSectionHeader
          onClick={props.onToggle}
          expanded={props.expanded}
          data-testid="sidebar-working-shelf-toggle"
          accessory={
            <span className="font-normal tabular-nums text-info-foreground">{props.count}</span>
          }
        >
          <span className="inline-flex items-center gap-1.5 text-info-foreground">
            <CircleDashedIcon aria-hidden className="size-3.5" />
            Working
          </span>
        </CollapsibleSectionHeader>
      </div>
      <ul
        role="tree"
        aria-label="Working threads"
        ref={attachDockTree}
        className="flex min-h-0 flex-col gap-px overflow-y-auto px-1 pb-1 empty:hidden"
      >
        {props.children}
      </ul>
    </div>
  );
}
