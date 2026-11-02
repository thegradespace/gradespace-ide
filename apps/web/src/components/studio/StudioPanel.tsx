import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  DownloadIcon,
  FileText,
  PencilLine,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useAtomCommand } from "~/state/use-atom-command";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { projectEnvironment } from "~/state/projects";

import { FileMarkdownPreview } from "../files/FileMarkdownPreview";
import { WorkspaceBrowserPreview } from "../files/FilePreviewPanel";
import { workspaceAssetResource } from "../files/filePreviewMode";
import {
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
} from "../files/fileSurfaceChrome";
import { useProjectEntriesQuery, useProjectFileQuery } from "../files/projectFilesQueryState";
import {
  parseStudioManifest,
  STUDIO_MANIFEST_NAME,
  STUDIO_ROOT,
  type StudioManifest,
  type StudioVariant,
  studioVariantKind,
  withStudioComment,
  withStudioPicked,
  withStudioPickLine,
} from "./studioManifest";

// Pages lay out at a desktop width and shrink to fit, so a thumbnail shows the whole design.
const THUMBNAIL_PAGE_WIDTH = 1280;

interface StudioContext {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly workspaceMutationId: string | null;
}

function showToast(type: "success" | "error", title: string, description?: string) {
  toastManager.add(
    stackedThreadToast({ type, title, ...(description === undefined ? {} : { description }) }),
  );
}

function StudioImage(props: StudioContext & { readonly absolutePath: string; alt: string }) {
  const assetUrl = useAssetUrlState(
    props.environmentId,
    workspaceAssetResource({
      kind: "workspace-file",
      threadRef: props.threadRef,
      draft: props.draft,
      workspaceRoot: props.cwd,
      absolutePath: props.absolutePath,
    }),
    props.workspaceMutationId,
  );
  if (assetUrl._tag === "Failure") return <FileSurfaceFailure message="Unable to load image." />;
  if (assetUrl._tag !== "Success") return <FileSurfaceLoading />;
  const revision =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  return (
    <img
      src={`${assetUrl.url}${revision}`}
      alt={props.alt}
      className="size-full min-h-0 flex-1 object-contain"
    />
  );
}

function StudioText(props: StudioContext & { readonly relativePath: string }) {
  const file = useProjectFileQuery(
    props.environmentId,
    props.cwd,
    props.relativePath,
    true,
    props.workspaceMutationId,
  );
  if (file.data === null) {
    return file.error === null ? (
      <FileSurfaceLoading />
    ) : (
      <FileSurfaceFailure message={file.error} />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <FileMarkdownPreview
        cwd={props.cwd}
        relativePath={props.relativePath}
        text={file.data.contents}
        threadRef={props.threadRef}
        workspaceMutationId={props.workspaceMutationId}
      />
    </div>
  );
}

function StudioFilePlaceholder(props: { readonly file: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground text-xs">
      <FileText className="size-6" />
      <span className="break-all">{props.file.split("/").at(-1)}</span>
    </div>
  );
}

function StudioVariantPreview(
  props: StudioContext & {
    readonly setPath: string;
    readonly variant: StudioVariant;
    readonly thumbnail: boolean;
  },
) {
  const relativePath = `${props.setPath}/${props.variant.file}`;
  const absolutePath = resolvePathLinkTarget(relativePath, props.cwd);
  const kind = studioVariantKind(props.variant.file);
  if (kind === "image") {
    return <StudioImage {...props} absolutePath={absolutePath} alt={props.variant.title} />;
  }
  if (kind === "text") return <StudioText {...props} relativePath={relativePath} />;
  if (kind === "html" || (kind === "pdf" && !props.thumbnail)) {
    return (
      <WorkspaceBrowserPreview
        key={absolutePath}
        environmentId={props.environmentId}
        threadRef={props.threadRef}
        draft={props.draft}
        absolutePath={absolutePath}
        workspaceRoot={props.cwd}
        title={props.variant.title}
        workspaceMutationId={props.workspaceMutationId}
      />
    );
  }
  return <StudioFilePlaceholder file={props.variant.file} />;
}

function ScaledThumbnail(props: { readonly fit: boolean; readonly children: React.ReactNode }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const attach = (element: HTMLDivElement | null) => {
    if (element === null) return;
    return observeResize(element, () =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
  };
  const scale = size === null ? 0 : size.width / THUMBNAIL_PAGE_WIDTH;
  return (
    <div ref={attach} className="pointer-events-none relative size-full overflow-hidden">
      {!props.fit ? (
        <div className="flex size-full flex-col">{props.children}</div>
      ) : size !== null ? (
        <div
          className="absolute top-0 left-0 flex origin-top-left flex-col"
          style={{
            width: THUMBNAIL_PAGE_WIDTH,
            height: size.height / scale,
            transform: `scale(${scale})`,
          }}
        >
          {props.children}
        </div>
      ) : null}
    </div>
  );
}

function StudioExportButton(
  props: StudioContext & { readonly setPath: string; readonly variant: StudioVariant },
) {
  const [saving, setSaving] = useState(false);
  const refreshAssetUrl = useAssetUrlRefresh(
    props.environmentId,
    workspaceAssetResource({
      kind: "workspace-file",
      threadRef: props.threadRef,
      draft: props.draft,
      workspaceRoot: props.cwd,
      absolutePath: resolvePathLinkTarget(`${props.setPath}/${props.variant.file}`, props.cwd),
    }),
  );
  const exportFile = async () => {
    const url = await refreshAssetUrl();
    if (!url) throw new Error("Reconnect to the environment and try again.");
    const response = await fetch(url);
    if (!response.ok) throw new Error("The file could not be loaded. Try again.");
    const downloadUrl = URL.createObjectURL(await response.blob());
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = props.variant.file.split("/").at(-1) ?? props.variant.file;
    anchor.click();
  };
  return (
    <FileSurfaceAction
      label={saving ? "Preparing file…" : "Export file"}
      disabled={saving}
      onPress={() => {
        setSaving(true);
        void exportFile()
          .catch((cause: unknown) =>
            showToast(
              "error",
              "Could not export file",
              cause instanceof Error ? cause.message : undefined,
            ),
          )
          .finally(() => setSaving(false));
      }}
    >
      <DownloadIcon className="size-3.5" />
    </FileSurfaceAction>
  );
}

function StudioPickButton(props: {
  readonly picked: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={props.picked ? "default" : "outline"}
      aria-pressed={props.picked}
      disabled={props.disabled}
      onClick={props.onPress}
    >
      {props.picked ? <Check /> : null}
      {props.picked ? "Picked" : "Pick"}
    </Button>
  );
}

function StudioVariantBadges(props: {
  readonly manifest: StudioManifest;
  readonly variant: StudioVariant;
}) {
  return props.manifest.recommended === props.variant.id ? (
    <Badge variant="info" size="sm">
      Recommended
    </Badge>
  ) : null;
}

function StudioSet(
  props: StudioContext & {
    readonly setPath: string;
    readonly composerDraftTarget: ScopedThreadRef | DraftId;
  },
) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const manifestPath = `${props.setPath}/${STUDIO_MANIFEST_NAME}`;
  const file = useProjectFileQuery(
    props.environmentId,
    props.cwd,
    manifestPath,
    true,
    props.workspaceMutationId,
  );
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });

  if (file.data === null) {
    return file.error === null ? (
      <FileSurfaceLoading />
    ) : (
      <FileSurfaceFailure message={file.error} />
    );
  }
  const contents = file.data.contents;
  const manifest = parseStudioManifest(contents);
  if (manifest === null) {
    return <FileSurfaceFailure message={`${manifestPath} is not a valid Studio file.`} />;
  }

  const updatePrompt = (update: (prompt: string) => string) => {
    const store = useComposerDraftStore.getState();
    const prompt = store.getComposerDraft(props.composerDraftTarget)?.prompt ?? "";
    store.setPrompt(props.composerDraftTarget, update(prompt));
  };

  const togglePick = async (variant: StudioVariant) => {
    const picked = manifest.picked === variant.id ? null : variant;
    const next = withStudioPicked(contents, picked?.id ?? null);
    if (next === null) return;
    setSaving(true);
    const result = await writeFile({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, relativePath: manifestPath, contents: next },
    });
    setSaving(false);
    if (result._tag !== "Success") {
      showToast("error", "Could not save your pick");
      return;
    }
    file.refresh();
    updatePrompt((prompt) => withStudioPickLine(prompt, manifest, props.setPath, picked));
    showToast(
      "success",
      picked === null ? "Pick cleared" : `Option ${picked.id} picked`,
      "Your message has been updated. Send it when you're ready.",
    );
  };

  const focused = manifest.variants.find((variant) => variant.id === focusedId) ?? null;

  if (focused !== null) {
    const kind = studioVariantKind(focused.file);
    const canEdit = kind === "html" || kind === "text";
    const relativePath = `${props.setPath}/${focused.file}`;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
          <FileSurfaceAction label="Back to all options" onPress={() => setFocusedId(null)}>
            <ArrowLeft className="size-3.5" />
          </FileSurfaceAction>
          {manifest.variants.map((variant) => (
            <Button
              key={variant.id}
              type="button"
              size="xs"
              variant={variant.id === focused.id ? "secondary" : "ghost"}
              aria-pressed={variant.id === focused.id}
              onClick={() => setFocusedId(variant.id)}
            >
              {variant.id}
            </Button>
          ))}
          <div className="min-w-0 flex-1" />
          <StudioPickButton
            picked={manifest.picked === focused.id}
            disabled={saving}
            onPress={() => void togglePick(focused)}
          />
          <FileSurfaceAction
            label={canEdit ? "Open to edit" : "Open in Files"}
            onPress={() => useRightPanelStore.getState().openFile(props.threadRef, relativePath)}
          >
            <PencilLine className="size-3.5" />
          </FileSurfaceAction>
          <StudioExportButton {...props} variant={focused} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-background">
          <StudioVariantPreview {...props} variant={focused} thumbnail={false} />
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-t p-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 truncate font-medium">{focused.title}</span>
            <StudioVariantBadges manifest={manifest} variant={focused} />
          </div>
          {focused.note ? <p className="text-muted-foreground text-xs">{focused.note}</p> : null}
          <Textarea
            size="sm"
            aria-label={`Comment on option ${focused.id}`}
            placeholder={`What should change in option ${focused.id}?`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={comment.trim().length === 0}
              onClick={() => {
                updatePrompt((prompt) =>
                  withStudioComment(prompt, manifest, props.setPath, focused, comment),
                );
                setComment("");
                showToast("success", "Comment added to your message");
              }}
            >
              Add to message
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] content-start gap-3 overflow-y-auto p-3">
      {manifest.variants.map((variant) => {
        const kind = studioVariantKind(variant.file);
        const picked = manifest.picked === variant.id;
        return (
          <div
            key={variant.id}
            className={cn(
              "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
              picked && "border-primary",
            )}
          >
            <button
              type="button"
              aria-label={`Open option ${variant.id}: ${variant.title}`}
              className="aspect-[4/3] w-full cursor-pointer overflow-hidden border-b bg-background"
              onClick={() => setFocusedId(variant.id)}
            >
              <ScaledThumbnail fit={kind === "html"}>
                <StudioVariantPreview {...props} variant={variant} thumbnail />
              </ScaledThumbnail>
            </button>
            <div className="flex flex-1 flex-col gap-1 p-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="shrink-0 font-semibold">{variant.id}</span>
                <span className="min-w-0 truncate font-medium">{variant.title}</span>
                <StudioVariantBadges manifest={manifest} variant={variant} />
              </div>
              {variant.note ? (
                <p className="line-clamp-2 text-muted-foreground text-xs">{variant.note}</p>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                <StudioPickButton
                  picked={picked}
                  disabled={saving}
                  onPress={() => void togglePick(variant)}
                />
                <StudioExportButton {...props} variant={variant} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StudioPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly workspaceMutationId: string | null;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const entries = useProjectEntriesQuery(
    props.environmentId,
    props.cwd,
    STUDIO_ROOT,
    props.workspaceMutationId,
  );
  // Set folders start with their date, so reverse name order is newest first.
  const sets = (entries.data?.entries ?? [])
    .filter(
      (entry) =>
        entry.kind === "directory" &&
        entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))) === STUDIO_ROOT,
    )
    .map((entry) => entry.path)
    .toSorted((left, right) => right.localeCompare(left));
  const setPath = selectedPath !== null && sets.includes(selectedPath) ? selectedPath : sets[0];
  const context = {
    environmentId: props.environmentId,
    cwd: props.cwd,
    threadRef: props.threadRef,
    draft: typeof props.composerDraftTarget === "string",
    workspaceMutationId: props.workspaceMutationId,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-studio-panel>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        {setPath === undefined ? (
          <span className="min-w-0 flex-1 px-1 font-medium text-xs">Studio</span>
        ) : (
          <div className="min-w-0 flex-1">
            <Menu>
              <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
                <span className="max-w-64 truncate">{setPath.split("/").at(-1)}</span>
                <ChevronDown />
              </MenuTrigger>
              <MenuPopup align="start" side="bottom" sideOffset={6} className="max-w-80">
                {sets.map((path) => (
                  <MenuItem key={path} onClick={() => setSelectedPath(path)}>
                    <span className="min-w-0 truncate">{path.split("/").at(-1)}</span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        )}
        <FileSurfaceAction label="Refresh" onPress={entries.refresh}>
          <RefreshCw className="size-3.5" />
        </FileSurfaceAction>
      </div>
      {setPath !== undefined ? (
        <StudioSet
          key={setPath}
          {...context}
          setPath={setPath}
          composerDraftTarget={props.composerDraftTarget}
        />
      ) : entries.isPending && entries.data === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          No options yet. Ask for a design, deck or piece of writing, and the options will appear
          here to compare.
        </div>
      )}
    </div>
  );
}
