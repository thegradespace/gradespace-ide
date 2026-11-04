import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isHostPath } from "@t3tools/shared/path";
import { AsyncResult } from "effect/reactivity";
import { CopyIcon, ExternalLinkIcon, FolderSearchIcon, MoreHorizontalIcon } from "lucide-react";
import { memo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useRemoteOpenResolution } from "../../remoteOpen";
import { useTimelineVisibleTurnItems, useThreadHistory } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { shellEnvironment } from "../../state/shell";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { RelativeTime } from "../RelativeTime";
import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "../preview/fileExplorerLabel";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { canUseMarkdownFileShellActions } from "./MarkdownFileLink.logic";
import { PierreEntryIcon } from "./PierreEntryIcon";
import {
  collectThreadMadeFiles,
  type ThreadMadeFile,
  type ThreadMadeFileChange,
} from "./threadMadeFiles.logic";

const METADATA_BATCH_LIMIT = 64;
const CHANGE_LABELS: Record<ThreadMadeFileChange, string> = {
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
};

function useMissingPaths(environmentId: EnvironmentId, files: ReadonlyArray<ThreadMadeFile>) {
  const paths = files
    .map((file) => file.path)
    .filter((path) => isHostPath(path) && path.length <= 512)
    .slice(0, METADATA_BATCH_LIMIT);
  const result = useAtomValue(
    filesystemEnvironment.getMetadata({
      environmentId,
      // The request needs at least one path; the root always exists, so an empty list asks nothing real.
      input: { paths: paths.length > 0 ? paths : ["/"] },
    }),
  );
  const missing = new Set<string>();
  if (!AsyncResult.isSuccess(result) || paths.length === 0) return missing;
  paths.forEach((path, index) => {
    if (result.value.entries[index] === null) missing.add(path);
  });
  return missing;
}

const ThreadFileRow = memo(function ThreadFileRow(props: {
  file: ThreadMadeFile;
  missing: boolean;
  theme: "light" | "dark";
  hint: string | null;
  canLaunch: boolean;
  revealLabel: string | null;
  onOpen: (file: ThreadMadeFile) => void;
  onLaunch: (file: ThreadMadeFile, reveal: boolean) => void;
}) {
  const { file, missing, hint } = props;
  const unavailable = missing || file.change === "deleted";
  return (
    <li className="relative flex items-center gap-1 rounded-md pr-1 hover:bg-accent/60">
      <button
        type="button"
        disabled={unavailable}
        onClick={() => props.onOpen(file)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
      >
        <PierreEntryIcon
          pathValue={file.name}
          kind="file"
          theme={props.theme}
          className={cn("size-3.5 shrink-0", unavailable && "opacity-50")}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm text-foreground",
              unavailable && "text-muted-foreground line-through",
            )}
          >
            {file.name}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {file.folder === "" ? "Project folder" : file.folder}
          </span>
        </span>
        <span className="shrink-0 text-right text-muted-foreground text-xs">
          {unavailable ? <span>{missing ? "Missing" : "Deleted"} · </span> : null}
          {!unavailable && hint ? <span>{hint} · </span> : null}
          <RelativeTime timestamp={file.changedAt} />
        </span>
      </button>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost-muted" size="icon-micro" aria-label={`Actions for ${file.name}`}>
              <MoreHorizontalIcon className="size-3.5" />
            </Button>
          }
        />
        <MenuPopup align="end" side="bottom" sideOffset={4}>
          {!unavailable && props.canLaunch ? (
            <MenuItem onClick={() => props.onLaunch(file, false)}>
              <ExternalLinkIcon className="size-3.5" />
              Open in default app
            </MenuItem>
          ) : null}
          {!missing && props.canLaunch && props.revealLabel !== null ? (
            <MenuItem onClick={() => props.onLaunch(file, true)}>
              <FolderSearchIcon className="size-3.5" />
              {props.revealLabel}
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => void writeTextToClipboard(file.path, "path")}>
            <CopyIcon className="size-3.5" />
            Copy full path
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
});

function FileSection(props: {
  title: string | null;
  files: ReadonlyArray<ThreadMadeFile>;
  missing: ReadonlySet<string>;
  theme: "light" | "dark";
  canLaunch: boolean;
  revealLabel: string | null;
  showHints: boolean;
  onOpen: (file: ThreadMadeFile) => void;
  onLaunch: (file: ThreadMadeFile, reveal: boolean) => void;
}) {
  if (props.files.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      {props.title ? (
        <h3 className="px-2 pt-2 font-medium text-muted-foreground text-xs">{props.title}</h3>
      ) : null}
      <ul className="flex flex-col">
        {props.files.map((file) => (
          <ThreadFileRow
            key={file.path}
            file={file}
            missing={props.missing.has(file.path)}
            theme={props.theme}
            hint={props.showHints && file.change ? CHANGE_LABELS[file.change] : null}
            canLaunch={props.canLaunch}
            revealLabel={props.revealLabel}
            onOpen={props.onOpen}
            onLaunch={props.onLaunch}
          />
        ))}
      </ul>
    </section>
  );
}

function FileLists(props: {
  environmentId: EnvironmentId;
  written: ReadonlyArray<ThreadMadeFile>;
  mentioned: ReadonlyArray<ThreadMadeFile>;
  theme: "light" | "dark";
  canLaunch: boolean;
  revealLabel: string | null;
  onOpen: (file: ThreadMadeFile) => void;
  onLaunch: (file: ThreadMadeFile, reveal: boolean) => void;
}) {
  const { environmentId, written, mentioned, ...sectionProps } = props;
  const missing = useMissingPaths(environmentId, [...written, ...mentioned]);
  return (
    <>
      <FileSection title={null} files={written} missing={missing} showHints {...sectionProps} />
      <FileSection
        title="Mentioned in replies"
        files={mentioned}
        missing={missing}
        showHints={false}
        {...sectionProps}
      />
    </>
  );
}

/** Every file the agent wrote or edited in this thread, plus files its replies point to. */
export function ThreadFilesPanel(props: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  cwd: string | null;
}) {
  const { environmentId, threadRef, cwd } = props;
  const { resolvedTheme } = useTheme();
  const rows = useTimelineVisibleTurnItems(threadRef);
  const history = useThreadHistory(threadRef);
  const loadEarlier = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: false,
  });
  const { written, mentioned } = collectThreadMadeFiles(rows, cwd);

  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canOperateHost = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const remoteOpen = useRemoteOpenResolution(environmentId);
  const canLaunch =
    canOperateHost &&
    canUseMarkdownFileShellActions(environmentId, remoteOpen.state.mode, remoteOpen.isResolved) &&
    config?.availableEditors.includes("file-manager") === true;
  const revealLabel =
    config?.shellRevealInFileManager === true
      ? config.shellRevealInFileManagerKind === undefined
        ? revealInFileExplorerLabelForOs(config.environment.platform.os)
        : revealInFileExplorerLabelForKind(config.shellRevealInFileManagerKind)
      : null;
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });

  const onOpen = (file: ThreadMadeFile) =>
    useRightPanelStore.getState().openFile(threadRef, file.path);
  const onLaunch = (file: ThreadMadeFile, reveal: boolean) => {
    void (async () => {
      const result = await openInEditor({
        environmentId,
        input: { cwd: file.path, editor: "file-manager", ...(reveal ? { reveal: true } : {}) },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: reveal ? "Unable to reveal file" : "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    })();
  };

  const listProps = {
    environmentId,
    written,
    mentioned,
    theme: resolvedTheme,
    canLaunch,
    revealLabel,
    onOpen,
    onLaunch,
  } as const;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {written.length === 0 && mentioned.length === 0 ? (
          <p className="px-2 py-6 text-center text-muted-foreground text-sm">
            Files the agent creates or edits in this thread will appear here.
          </p>
        ) : (
          <FileLists {...listProps} />
        )}
        {history.hasMoreHistory ? (
          <div className="flex justify-center px-2 py-3">
            <Button
              variant="ghost"
              size="xs"
              disabled={history.loading}
              onClick={() =>
                void loadEarlier({
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId },
                })
              }
            >
              {history.loading ? "Loading earlier turns…" : "Load earlier turns to find more files"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
