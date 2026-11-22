import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  filterLibrary,
  formatBytes,
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_NAMES,
  libraryCounts,
  libraryReuse,
  type LibrarySort,
  libraryUndoIds,
} from "@t3tools/client-runtime/library";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  LibraryCategory,
  LibraryItem,
  LibraryReport,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  BriefcaseIcon,
  FileIcon,
  LayoutGridIcon,
  MonitorIcon,
  PencilIcon,
  Trash2Icon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { AppRouteModal, AppRouteModalClose } from "../components/AppRouteModal";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { CheckboxMark } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toastManager } from "../components/ui/toast";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";
import { usePrimaryEnvironmentId } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { shellEnvironment } from "../state/shell";
import { useAtomCommand } from "../state/use-atom-command";
import { setActiveWorkspace } from "../workspaces/workspaceStore";

const CATEGORY_LOOK: Readonly<Record<LibraryCategory, { icon: LucideIcon; tile: string }>> = {
  deck: { icon: MonitorIcon, tile: "bg-primary/15 text-primary" },
  design: { icon: LayoutGridIcon, tile: "bg-info/15 text-info" },
  writing: { icon: PencilIcon, tile: "bg-success/15 text-success" },
  video: { icon: VideoIcon, tile: "bg-destructive/15 text-destructive" },
  application: { icon: BriefcaseIcon, tile: "bg-warning/15 text-warning" },
  other: { icon: FileIcon, tile: "bg-muted text-muted-foreground" },
};

const dateLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const failureText = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const failure = squashAtomCommandFailure(result);
  if (failure && typeof failure === "object" && "reason" in failure) {
    if (failure.reason === "restoreConflict") {
      return "Something new is already in its old place. Move or rename it, then restore again.";
    }
    if (failure.reason === "unknownItem")
      return "It has already moved or gone. Refresh and try again.";
  }
  return failure instanceof Error ? failure.message : "Try again in a moment.";
};

/** Everything agents made on this machine, with Recently deleted at the bottom. */
export function LibraryPage() {
  const environmentId = usePrimaryEnvironmentId();
  const serverConfig = useAtomValue(environmentServerConfigsAtom).get(
    environmentId ?? ("" as EnvironmentId),
  );
  return (
    <AppRouteModal label="Library">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {environmentId !== null && serverConfig?.environment.capabilities.library === true ? (
          <LibraryWithReport environmentId={environmentId} />
        ) : (
          <>
            <LibraryHeader />
            <WorkspacePageContainer width="wide">
              <p className="text-sm text-muted-foreground">
                Update Gradespace on this machine to see everything your agents made.
              </p>
            </WorkspacePageContainer>
          </>
        )}
      </div>
    </AppRouteModal>
  );
}

function LibraryHeader(props: { children?: React.ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b ps-5 pe-2">
      <h1 className="text-sm font-medium text-foreground">Library</h1>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{props.children}</div>
      <AppRouteModalClose />
    </header>
  );
}

function LibraryWithReport(props: { environmentId: EnvironmentId }) {
  const query = serverEnvironment.libraryList({ environmentId: props.environmentId, input: {} });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LibrarySort>("newest");
  return (
    <>
      <LibraryHeader>
        <div className="w-full max-w-72">
          <Input
            aria-label="Search the library"
            placeholder="Search everything you've made"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        <Select
          value={sort}
          onValueChange={(value) => setSort(value === "largest" ? "largest" : "newest")}
        >
          <SelectTrigger aria-label="Sort" className="w-36">
            <SelectValue>{sort === "largest" ? "Largest first" : "Newest first"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="largest">Largest first</SelectItem>
          </SelectPopup>
        </Select>
      </LibraryHeader>
      <ScrollArea className="min-h-0 flex-1">
        <WorkspacePageContainer width="wide">
          {result._tag === "Success" ? (
            <LibraryBody
              environmentId={props.environmentId}
              report={result.value}
              search={search}
              sort={sort}
              onChanged={refresh}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {result.waiting
                ? "Gathering everything your agents made…"
                : "Could not read the library."}
            </p>
          )}
        </WorkspacePageContainer>
      </ScrollArea>
    </>
  );
}

function LibraryBody(props: {
  environmentId: EnvironmentId;
  report: LibraryReport;
  search: string;
  sort: LibrarySort;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<LibraryCategory | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const remove = useAtomCommand(serverEnvironment.deleteLibraryItems, { reportFailure: false });
  const restore = useAtomCommand(serverEnvironment.restoreLibraryItems, { reportFailure: false });
  const empty = useAtomCommand(serverEnvironment.emptyLibraryTrash, { reportFailure: false });
  const canChange = useAtomValue(
    serverEnvironment.deleteLibraryItems.permissionAtom(props.environmentId),
  );
  const counts = libraryCounts(props.report.items);
  const shown = filterLibrary(props.report.items, {
    category,
    query: props.search,
    sort: props.sort,
  });
  const open = props.report.items.find((item) => item.id === openId) ?? null;
  const trashBytes = props.report.trash.reduce((total, item) => total + item.sizeBytes, 0);
  // Only what is still listed and shown counts, so a filter or a delete elsewhere never deletes unseen items.
  const selected = shown.filter((item) => picked.has(item.id));
  const selectedBytes = selected.reduce((total, item) => total + item.sizeBytes, 0);
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const onRestore = async (ids: ReadonlyArray<string>) => {
    const result = await restore({ environmentId: props.environmentId, input: { ids } });
    if (result._tag === "Success") props.onChanged();
    else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not restore it",
        description: failureText(result),
      });
    }
  };

  const onDelete = async (items: ReadonlyArray<LibraryItem>) => {
    if (items.length === 0) return;
    setOpenId(null);
    const result = await remove({
      environmentId: props.environmentId,
      input: { ids: items.map((item) => item.id) },
    });
    if (result._tag !== "Success") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: items.length === 1 ? "Could not delete it" : "Could not delete them",
          description: failureText(result),
        });
      }
      return;
    }
    stopSelecting();
    props.onChanged();
    const undo = libraryUndoIds(result.value.trash, items);
    toastManager.add({
      type: "success",
      title:
        items.length === 1
          ? `Moved “${items[0]?.title}” to Recently deleted`
          : `Moved ${items.length} items to Recently deleted`,
      description: `Restore ${items.length === 1 ? "it" : "them"} within 30 days, or empty Recently deleted to free the space now.`,
      ...(undo.length > 0
        ? { actionProps: { children: "Undo", onClick: () => void onRestore(undo) } }
        : {}),
    });
  };

  const onEmpty = async () => {
    const confirmed = await readLocalApi()?.dialogs.confirm(
      `Delete ${props.report.trash.length} item${props.report.trash.length === 1 ? "" : "s"} for good and free ${formatBytes(trashBytes)}? This can't be undone.`,
    );
    if (!confirmed) return;
    const result = await empty({ environmentId: props.environmentId, input: {} });
    if (result._tag === "Success") props.onChanged();
    else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not empty it",
        description: failureText(result),
      });
    }
  };

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(event) => {
        if (selecting && event.key === "Escape") {
          // Leave select mode first; the Library itself closes on the next Esc.
          event.stopPropagation();
          stopSelecting();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-[1_1_16rem] flex-wrap gap-1.5" role="group" aria-label="Show">
          {[{ id: "all" as const, label: "All" }, ...LIBRARY_CATEGORIES].map((entry) =>
            entry.id !== "all" && counts[entry.id] === 0 ? null : (
              <Button
                key={entry.id}
                type="button"
                size="xs"
                variant={category === entry.id ? "secondary" : "ghost-muted"}
                aria-pressed={category === entry.id}
                onClick={() => setCategory(entry.id)}
              >
                {entry.label} {counts[entry.id]}
              </Button>
            ),
          )}
        </div>
        {selecting ? (
          <div className="flex items-center gap-1.5" role="group" aria-label="Selection">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {selected.length === 0
                ? "Tick the items to delete"
                : `${selected.length} selected · ${formatBytes(selectedBytes)}`}
            </span>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              disabled={selected.length === 0 || !canChange}
              onClick={() => void onDelete(selected)}
            >
              <Trash2Icon aria-hidden />
              Delete {selected.length}
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={stopSelecting}>
              Cancel
            </Button>
          </div>
        ) : canChange && shown.length > 0 ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={() => setSelecting(true)}>
            Select
          </Button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {props.report.items.length === 0
            ? "Nothing yet. Decks, designs, writing, video cuts and applications your agents make show up here."
            : "Nothing matches."}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
          {shown.map((item) => (
            <li key={item.id}>
              <LibraryCard
                item={item}
                selecting={selecting}
                selected={picked.has(item.id)}
                canDelete={canChange}
                onOpen={() => (selecting ? togglePicked(item.id) : setOpenId(item.id))}
                onDelete={() => void onDelete([item])}
              />
            </li>
          ))}
        </ul>
      )}
      {props.report.trash.length > 0 ? (
        <section aria-label="Recently deleted" className="flex flex-col gap-2 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">
              Recently deleted · {formatBytes(trashBytes)}
            </h2>
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              disabled={!canChange}
              onClick={() => void onEmpty()}
            >
              Empty now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Kept for 30 days, then deleted for good. The chats that made them stay.
          </p>
          <ul className="flex flex-col">
            {props.report.trash.map((item) => (
              <li key={item.id} className="flex min-h-9 items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {LIBRARY_CATEGORY_NAMES[item.category]} · {formatBytes(item.sizeBytes)} · deleted{" "}
                  {dateLabel(item.deletedAt)}
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!canChange}
                  onClick={() => void onRestore([item.id])}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ItemDialog
        item={open}
        environmentId={props.environmentId}
        canDelete={canChange}
        onClose={() => setOpenId(null)}
        onDelete={(item) => void onDelete([item])}
      />
    </div>
  );
}

function LibraryCard(props: {
  item: LibraryItem;
  selecting: boolean;
  selected: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { item } = props;
  const look = CATEGORY_LOOK[item.category];
  const Icon = look.icon;
  const details = [
    LIBRARY_CATEGORY_NAMES[item.category],
    item.projectTitle,
    dateLabel(item.updatedAt),
  ].filter(Boolean);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={props.onOpen}
        aria-label={props.selecting ? `Select ${item.title}` : `Open ${item.title}`}
        aria-pressed={props.selecting ? props.selected : undefined}
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card/70 text-left outline-hidden ring-ring hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset",
          props.selected && "border-primary ring-1 ring-primary",
        )}
      >
        <span className={cn("relative flex h-20 items-center justify-center", look.tile)}>
          <Icon aria-hidden className="size-6" />
          {props.selecting ? (
            <span className="absolute top-2 left-2 flex">
              <CheckboxMark checked={props.selected} variant="contrast" />
            </span>
          ) : null}
        </span>
        <span className="flex flex-col gap-0.5 p-2.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
            {item.archived ? (
              <Badge variant="outline" size="sm">
                Archived
              </Badge>
            ) : null}
          </span>
          <span className="truncate text-xs text-muted-foreground">{details.join(" · ")}</span>
          <span className="text-xs text-muted-foreground">
            {item.source === "career"
              ? `${item.optionCount} file${item.optionCount === 1 ? "" : "s"}`
              : item.picked
                ? `Picked ${item.picked} of ${item.optionCount}`
                : `${item.optionCount} option${item.optionCount === 1 ? "" : "s"}`}
            {" · "}
            {formatBytes(item.sizeBytes)}
          </span>
        </span>
      </button>
      {props.selecting || !props.canDelete ? null : (
        <span className="absolute top-2 right-2 flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <Button
            type="button"
            size="icon-xs"
            variant="glass"
            aria-label={`Delete ${item.title}`}
            onClick={props.onDelete}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </span>
      )}
    </div>
  );
}

function ItemDialog(props: {
  item: LibraryItem | null;
  environmentId: EnvironmentId;
  canDelete: boolean;
  onClose: () => void;
  onDelete: (item: LibraryItem) => void;
}) {
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const { openScratchProject } = useScratchProject();
  const openInFileManager = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const item = props.item;

  const reuse = async (target: LibraryItem) => {
    const { workspace, prompt } = libraryReuse(target);
    const project =
      target.projectId !== null
        ? scopeProjectRef(props.environmentId, target.projectId as never)
        : await openScratchProject(props.environmentId).then((scratch) =>
            scratch ? scopeProjectRef(scratch.environmentId, scratch.id) : null,
          );
    if (project === null) return;
    props.onClose();
    setActiveWorkspace(workspace);
    await handleNewThread(project, { prompt }).catch(() =>
      toastManager.add({ type: "error", title: "Could not start a chat from it" }),
    );
  };

  return (
    <Dialog open={item !== null} onOpenChange={(open) => (open ? null : props.onClose())}>
      {item ? (
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{item.title}</DialogTitle>
            <DialogDescription>
              {[
                LIBRARY_CATEGORY_NAMES[item.category],
                item.projectTitle,
                dateLabel(item.updatedAt),
                formatBytes(item.sizeBytes),
              ]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2 text-sm">
              <span className="text-foreground">
                {item.source === "career"
                  ? `${item.optionCount} files: CV, statement and answers`
                  : `${item.optionCount} option${item.optionCount === 1 ? "" : "s"}${item.picked ? `, ${item.picked} picked` : ""}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {item.threadTitle
                  ? `Made in “${item.threadTitle}”`
                  : "Made outside a chat this machine knows"}
              </span>
              <span className="break-all text-xs text-muted-foreground">{item.path}</span>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={!props.canDelete}
              onClick={() => props.onDelete(item)}
            >
              <Trash2Icon aria-hidden />
              Delete
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void openInFileManager({
                  environmentId: props.environmentId,
                  input: { cwd: item.path, editor: "file-manager" },
                })
              }
            >
              Show in folder
            </Button>
            {item.threadId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  props.onClose();
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: { environmentId: props.environmentId, threadId: item.threadId ?? "" },
                  });
                }}
              >
                Open chat
              </Button>
            ) : null}
            <Button type="button" onClick={() => void reuse(item)}>
              Reuse as a start
            </Button>
          </DialogFooter>
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}
