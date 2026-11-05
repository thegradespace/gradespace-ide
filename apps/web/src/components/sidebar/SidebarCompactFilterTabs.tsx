import { cn } from "~/lib/utils";
import type { SidebarCompactFilter, SidebarCompactGroup } from "../Sidebar.logic";

const TABS: ReadonlyArray<{
  value: SidebarCompactFilter;
  label: string;
  countClassName?: string;
}> = [
  { value: "all", label: "All" },
  { value: "working", label: "Working", countClassName: "text-info-foreground" },
  { value: "needs-you", label: "Needs you", countClassName: "text-warning-foreground" },
  { value: "done", label: "Done", countClassName: "text-success-foreground" },
];

export function SidebarCompactFilterTabs(props: {
  value: SidebarCompactFilter;
  counts: Readonly<Record<SidebarCompactGroup, number>>;
  onValueChange: (value: SidebarCompactFilter) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter threads"
      className="flex flex-wrap items-center gap-px pt-1.5"
    >
      {TABS.map((tab) => {
        const selected = props.value === tab.value;
        const count = tab.value === "all" ? null : props.counts[tab.value];
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`sidebar-filter-${tab.value}`}
            onClick={() => props.onValueChange(tab.value)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selected
                ? "bg-sidebar-row-active text-sidebar-foreground"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            )}
          >
            {tab.label}
            {count === null ? null : (
              <span
                className={cn(
                  "tabular-nums",
                  count > 0 ? tab.countClassName : "text-sidebar-muted-foreground/60",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
