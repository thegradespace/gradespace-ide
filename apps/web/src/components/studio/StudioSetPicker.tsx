import { useAtomValue } from "@effect/atom-react";
import { libraryUndoIds, studioLibraryItemId } from "@t3tools/client-runtime/library";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ArchiveIcon, ArchiveRestoreIcon, ChevronDown, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSearchInput,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import { environmentServerConfigsAtom, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { getProjectFileQueryAtom, getProjectFileContents } from "../files/projectFilesQueryState";
import {
  filterStudioSets,
  STUDIO_MANIFEST_NAME,
  type StudioSetSummary,
  withStudioArchived,
} from "./studioManifest";

/** Past this many sets the list gets a search box. */
const SEARCH_FROM = 6;

const folderName = (path: string) => path.split("/").at(-1) ?? path;

const failureText = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const failure = squashAtomCommandFailure(result);
  if (failure && typeof failure === "object" && "reason" in failure) {
    if (failure.reason === "unknownItem")
      return "It has already moved or gone. Refresh and try again.";
    if (failure.reason === "restoreConflict") {
      return "Something new is already in its old place. Move or rename it, then restore again.";
    }
  }
  return failure instanceof Error ? failure.message : "Try again in a moment.";
};

export function StudioSetPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly sets: ReadonlyArray<StudioSetSummary>;
  readonly setPath: string;
  readonly showArchived: boolean;
  readonly onShowArchivedChange: (show: boolean) => void;
  readonly onSelect: (path: string) => void;
  /** After a set is archived, deleted or put back; `gone` is the set that left the list. */
  readonly onChanged: (gone: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.deleteLibraryItems, { reportFailure: false });
  const restore = useAtomCommand(serverEnvironment.restoreLibraryItems, { reportFailure: false });
  const canDelete = useAtomValue(
    serverEnvironment.deleteLibraryItems.permissionAtom(props.environmentId),
  );
  const hasLibrary =
    useAtomValue(environmentServerConfigsAtom).get(props.environmentId)?.environment.capabilities
      .library === true;
  const { shown, archivedCount } = filterStudioSets(props.sets, {
    query,
    showArchived: props.showArchived,
  });
  const current = props.sets.find((set) => set.path === props.setPath);

  const setArchived = async (set: StudioSetSummary, archived: boolean) => {
    const manifestPath = `${set.path}/${STUDIO_MANIFEST_NAME}`;
    const contents = getProjectFileContents(props.environmentId, props.cwd, manifestPath);
    const next = contents === undefined ? null : withStudioArchived(contents, archived);
    const result =
      next === null
        ? null
        : await writeFile({
            environmentId: props.environmentId,
            input: { cwd: props.cwd, relativePath: manifestPath, contents: next },
          });
    if (result?._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: archived ? "Could not archive it" : "Could not unarchive it",
      });
      return;
    }
    appAtomRegistry.refresh(getProjectFileQueryAtom(props.environmentId, props.cwd, manifestPath));
    props.onChanged(archived && !props.showArchived ? set.path : null);
    const title = set.title ?? folderName(set.path);
    toastManager.add({
      type: "success",
      title: archived ? `Archived “${title}”` : `“${title}” is back in the list`,
      ...(archived
        ? {
            description: "Library still has it. Show archived sets to bring it back.",
            actionProps: { children: "Undo", onClick: () => void setArchived(set, false) },
          }
        : {}),
    });
  };

  const deleteSet = async (set: StudioSetSummary) => {
    const id = studioLibraryItemId(props.cwd, set.path);
    const title = set.title ?? folderName(set.path);
    const result = await remove({ environmentId: props.environmentId, input: { ids: [id] } });
    if (result._tag !== "Success") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not delete it",
          description: failureText(result),
        });
      }
      return;
    }
    props.onChanged(set.path);
    const undo = libraryUndoIds(result.value.trash, [{ id, title }]);
    toastManager.add({
      type: "success",
      title: `Moved “${title}” to Recently deleted`,
      description: "Restore it from the Library within 30 days.",
      ...(undo.length > 0
        ? {
            actionProps: {
              children: "Undo",
              onClick: () =>
                void restore({ environmentId: props.environmentId, input: { ids: undo } }).then(
                  (restored) => {
                    if (restored._tag === "Success") props.onChanged(null);
                    else if (!isAtomCommandInterrupted(restored)) {
                      toastManager.add({
                        type: "error",
                        title: "Could not restore it",
                        description: failureText(restored),
                      });
                    }
                  },
                ),
            },
          }
        : {}),
    });
  };

  return (
    <Menu onOpenChange={(open) => (open ? null : setQuery(""))}>
      <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
        <span className="max-w-64 truncate">{current?.title ?? folderName(props.setPath)}</span>
        <ChevronDown />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" sideOffset={6} className="w-80">
        {props.sets.length >= SEARCH_FROM ? (
          <MenuSearchInput
            autoFocus
            aria-label="Search sets"
            placeholder="Search sets"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        ) : null}
        {shown.length === 0 ? (
          <div className="px-2 py-1.5 text-muted-foreground text-xs">
            {query.trim().length > 0 ? "No sets match." : "Every set here is archived."}
          </div>
        ) : null}
        {shown.map((set) => {
          const title = set.title ?? folderName(set.path);
          return (
            <div key={set.path} className="flex items-center gap-0.5">
              <MenuItem className="min-w-0 flex-1" onClick={() => props.onSelect(set.path)}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{title}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {folderName(set.path)}
                  </span>
                </span>
                {set.archived ? (
                  <Badge variant="outline" size="sm">
                    Archived
                  </Badge>
                ) : null}
              </MenuItem>
              <MenuSub>
                <MenuSubTrigger aria-label={`More for ${title}`} className="shrink-0" />
                <MenuSubPopup>
                  <MenuItem
                    disabled={set.title === null}
                    onClick={() => void setArchived(set, !set.archived)}
                  >
                    {set.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                    {set.archived ? "Unarchive" : "Archive"}
                  </MenuItem>
                  <MenuItem
                    variant="destructive"
                    disabled={!canDelete || !hasLibrary}
                    onClick={() => void deleteSet(set)}
                  >
                    <Trash2Icon />
                    Delete
                  </MenuItem>
                </MenuSubPopup>
              </MenuSub>
            </div>
          );
        })}
        {archivedCount > 0 ? (
          <>
            <MenuSeparator />
            <MenuCheckboxItem
              variant="switch"
              closeOnClick={false}
              checked={props.showArchived}
              onCheckedChange={(checked) => props.onShowArchivedChange(checked)}
            >
              Show archived ({archivedCount})
            </MenuCheckboxItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
