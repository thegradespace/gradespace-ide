import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { FileText } from "lucide-react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";

import { FileMarkdownPreview } from "../files/FileMarkdownPreview";
import { WorkspaceBrowserPreview } from "../files/FilePreviewPanel";
import { workspaceAssetResource } from "../files/filePreviewMode";
import { FileSurfaceFailure, FileSurfaceLoading } from "../files/fileSurfaceChrome";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { type StudioVariant, studioVariantKind } from "./studioManifest";

export interface StudioContext {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly workspaceMutationId: string | null;
}

export function showToast(type: "success" | "error", title: string, description?: string) {
  toastManager.add(
    stackedThreadToast({ type, title, ...(description === undefined ? {} : { description }) }),
  );
}

/** Zoomed single-design view; thumbnails omit it and keep the plain fit. */
export interface StudioView {
  readonly zoom: number;
  readonly fit: boolean;
  readonly imageSize: { readonly width: number; readonly height: number } | null;
  readonly onImageSize: (size: { readonly width: number; readonly height: number }) => void;
}

function StudioImage(
  props: StudioContext & {
    readonly absolutePath: string;
    readonly alt: string;
    readonly view?: StudioView | undefined;
  },
) {
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
  const src = `${assetUrl.url}${revision}`;
  const view = props.view;
  if (view === undefined) {
    return <img src={src} alt={props.alt} className="size-full min-h-0 flex-1 object-contain" />;
  }
  const scaled = !view.fit && view.imageSize !== null;
  return (
    <div className="scrollbar-gutter-both flex min-h-0 flex-1 overflow-auto">
      <img
        src={src}
        alt={props.alt}
        className={
          scaled ? "m-auto max-w-none shrink-0" : "size-full min-h-0 flex-1 object-contain"
        }
        style={scaled ? { width: view.imageSize!.width * view.zoom } : undefined}
        onLoad={(event) =>
          view.onImageSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
      />
    </div>
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

export function StudioVariantPreview(
  props: StudioContext & {
    readonly setPath: string;
    readonly variant: StudioVariant;
    readonly thumbnail: boolean;
    readonly view?: StudioView | undefined;
  },
) {
  const relativePath = `${props.setPath}/${props.variant.file}`;
  const absolutePath = resolvePathLinkTarget(relativePath, props.cwd);
  const kind = studioVariantKind(props.variant.file);
  if (kind === "image") {
    return (
      <StudioImage
        {...props}
        absolutePath={absolutePath}
        alt={props.variant.title}
        view={props.view}
      />
    );
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
        studioZoom={props.view !== undefined && kind === "html"}
      />
    );
  }
  return <StudioFilePlaceholder file={props.variant.file} />;
}
