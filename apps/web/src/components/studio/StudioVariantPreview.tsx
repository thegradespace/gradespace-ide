import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { FileText } from "lucide-react";
import { useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { prepareVideoFirstFrame } from "~/lib/videoFirstFrame";

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
  /** Changes when Studio should reread its files: after agent work, on focus, or on Refresh. */
  readonly readRevision: string;
}

export function showToast(type: "success" | "error", title: string, description?: string) {
  toastManager.add(
    stackedThreadToast({ type, title, ...(description === undefined ? {} : { description }) }),
  );
}

/** Video goes through the media route: the workspace route only serves preview documents and images. */
export function studioAssetResource(context: StudioContext, absolutePath: string) {
  return workspaceAssetResource({
    kind: studioVariantKind(absolutePath) === "video" ? "media-file" : "workspace-file",
    threadRef: context.threadRef,
    draft: context.draft,
    workspaceRoot: context.cwd,
    absolutePath,
  });
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
    studioAssetResource(props, props.absolutePath),
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

/**
 * Each read re-mints the URL, but the source only changes with the file's revision (size and
 * mtime on the server), so an unchanged video keeps playing. Nothing autoplays; thumbnails show
 * the first frame.
 */
function StudioVideo(
  props: StudioContext & {
    readonly absolutePath: string;
    readonly label: string;
    readonly thumbnail: boolean;
    readonly view?: StudioView | undefined;
  },
) {
  const assetUrl = useAssetUrlState(
    props.environmentId,
    studioAssetResource(props, props.absolutePath),
    props.readRevision,
  );
  const [loaded, setLoaded] = useState<{ revision: string; src: string } | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const revision =
    assetUrl._tag === "Success" ? (assetUrl.fileRevision ?? props.readRevision) : null;
  const latestSrc =
    assetUrl._tag === "Success" && revision !== null
      ? `${assetUrl.url}${assetUrl.url.includes("?") ? "&" : "?"}file-revision=${encodeURIComponent(revision)}`
      : null;
  // A kept source can outlive its signed URL, so a failed one moves to a fresher URL when there is one.
  if (
    latestSrc !== null &&
    revision !== null &&
    (loaded?.revision !== revision || (failedSrc === loaded.src && latestSrc !== loaded.src))
  ) {
    setLoaded({ revision, src: latestSrc });
  }
  if (assetUrl._tag === "Failure") return <FileSurfaceFailure message="Unable to load video." />;
  if (loaded === null) return <FileSurfaceLoading />;
  if (failedSrc === loaded.src) return <FileSurfaceFailure message="Unable to play this video." />;
  const view = props.view;
  const scaled = view !== undefined && !view.fit && view.imageSize !== null;
  const video = (
    <video
      src={loaded.src}
      aria-label={props.label}
      controls={!props.thumbnail}
      muted={props.thumbnail}
      playsInline
      preload="metadata"
      className={
        scaled
          ? "m-auto max-w-none shrink-0 bg-black"
          : "size-full min-h-0 flex-1 bg-black object-contain"
      }
      style={scaled ? { width: view.imageSize!.width * view.zoom } : undefined}
      onLoadedMetadata={(event) => {
        prepareVideoFirstFrame(event.currentTarget);
        view?.onImageSize({
          width: event.currentTarget.videoWidth,
          height: event.currentTarget.videoHeight,
        });
      }}
      onError={() => setFailedSrc(loaded.src)}
    />
  );
  if (view === undefined) return video;
  return <div className="scrollbar-gutter-both flex min-h-0 flex-1 overflow-auto">{video}</div>;
}

function StudioText(props: StudioContext & { readonly relativePath: string }) {
  const file = useProjectFileQuery(
    props.environmentId,
    props.cwd,
    props.relativePath,
    true,
    props.readRevision,
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

function contentRevision(contents: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < contents.length; index += 1) {
    hash = Math.imul(hash ^ contents.charCodeAt(index), 0x01000193) >>> 0;
  }
  return `${contents.length.toString(36)}-${hash.toString(36)}`;
}

/** Reloads the frame only when the page's text changed, so other workspace changes do not flash it. */
function StudioHtml(
  props: StudioContext & {
    readonly relativePath: string;
    readonly variant: StudioVariant;
    readonly view?: StudioView | undefined;
  },
) {
  const file = useProjectFileQuery(
    props.environmentId,
    props.cwd,
    props.relativePath,
    true,
    props.readRevision,
  );
  const revision =
    file.data !== null
      ? contentRevision(file.data.contents)
      : file.error !== null
        ? props.workspaceMutationId
        : undefined;
  if (revision === undefined) return <FileSurfaceLoading />;
  const absolutePath = resolvePathLinkTarget(props.relativePath, props.cwd);
  return (
    <WorkspaceBrowserPreview
      key={absolutePath}
      environmentId={props.environmentId}
      threadRef={props.threadRef}
      draft={props.draft}
      absolutePath={absolutePath}
      workspaceRoot={props.cwd}
      title={props.variant.title}
      workspaceMutationId={revision}
      studioZoom={props.view !== undefined}
    />
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
  if (kind === "video") {
    return (
      <StudioVideo
        key={absolutePath}
        {...props}
        absolutePath={absolutePath}
        label={props.variant.title}
        view={props.view}
      />
    );
  }
  if (kind === "text") return <StudioText {...props} relativePath={relativePath} />;
  if (kind === "html") return <StudioHtml {...props} relativePath={relativePath} />;
  if (kind === "pdf" && !props.thumbnail) {
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
