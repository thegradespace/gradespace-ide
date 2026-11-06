import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { ChevronDown, DownloadIcon } from "lucide-react";
import { useState } from "react";

import { useAssetUrlRefresh } from "~/assets/assetUrls";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import {
  type StudioVariant,
  studioDownloadFileName,
  studioShownVariant,
  studioVariantKind,
  type StudioViewedVersion,
} from "./studioManifest";
import { type StudioContext, showToast, studioAssetResource } from "./StudioVariantPreview";

type DownloadFormat = "file" | "png" | "pdf";

function clickDownloadLink(href: string, fileName: string, owner: Document) {
  const anchor = owner.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
}

/**
 * Saves the file's bytes as they are, through the window that owns the clicked button. On the web
 * a video streams to disk from an attachment URL; the token in the URL is its auth. Desktop and
 * draft threads load it as a blob instead: desktop sends cross-origin navigations to the external
 * browser, and draft media URLs cannot ask for an attachment.
 */
export function useStudioFileSaver(context: StudioContext, absolutePath: string) {
  const resource = studioAssetResource(context, absolutePath);
  const refreshUrl = useAssetUrlRefresh(context.environmentId, resource);
  const attachment =
    resource._tag === "media-file" && window.desktopBridge === undefined
      ? { ...resource, disposition: "attachment" as const }
      : null;
  const refreshAttachmentUrl = useAssetUrlRefresh(context.environmentId, attachment);
  return async (fileName: string, owner: Document) => {
    if (attachment !== null) {
      const url = await refreshAttachmentUrl();
      if (!url) throw new Error("Reconnect to the environment and try again.");
      clickDownloadLink(url, fileName, owner);
      return;
    }
    const url = await refreshUrl();
    if (!url) throw new Error("Reconnect to the environment and try again.");
    const response = await fetch(url);
    if (!response.ok) throw new Error("The file could not be loaded. Try again.");
    const blobUrl = URL.createObjectURL(await response.blob());
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    clickDownloadLink(blobUrl, fileName, owner);
  };
}

const extensionOf = (file: string) => file.split(".").at(-1)?.toLowerCase() ?? "file";

/**
 * Downloads the option being viewed. HTML can also be rendered to PNG or PDF at its natural size,
 * which needs the desktop app; elsewhere only the file itself is offered.
 */
export function StudioDownloadButton(
  props: StudioContext & {
    readonly setPath: string;
    readonly variant: StudioVariant;
    readonly version: StudioViewedVersion;
    /** Names the option when more than one toolbar has a Download button. */
    readonly optionLabel?: string | undefined;
  },
) {
  const shown = studioShownVariant(props.variant, props.version);
  const absolutePath = resolvePathLinkTarget(`${props.setPath}/${shown.file}`, props.cwd);
  const refreshAssetUrl = useAssetUrlRefresh(
    props.environmentId,
    studioAssetResource(props, absolutePath),
  );
  const saveFile = useStudioFileSaver(props, absolutePath);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const exportDesign = window.desktopBridge?.exportStudioDesign;
  const extension = extensionOf(shown.file);
  const renderable = studioVariantKind(shown.file) === "html" && exportDesign !== undefined;
  const fileName = (ext: string) =>
    studioDownloadFileName(props.setPath, props.variant, props.version, ext);
  const label =
    props.optionLabel === undefined ? "Download" : `Download option ${props.optionLabel}`;

  const download = async (format: DownloadFormat, owner: Document) => {
    if (format === "file") {
      await saveFile(fileName(extension), owner);
      return;
    }
    if (exportDesign === undefined) return;
    const url = await refreshAssetUrl();
    if (!url) throw new Error("Reconnect to the environment and try again.");
    await exportDesign({ url, format, fileName: fileName(format) });
  };
  const run = (format: DownloadFormat, owner: Document) => {
    setOpen(false);
    setBusy(true);
    void download(format, owner)
      .catch((cause: unknown) =>
        showToast(
          "error",
          "Could not download the design",
          cause instanceof Error ? cause.message : undefined,
        ),
      )
      .finally(() => setBusy(false));
  };

  if (!renderable) {
    return (
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="shrink-0"
        aria-label={`${label} ${extension.toUpperCase()}`}
        title={`${label} ${extension.toUpperCase()}`}
        disabled={busy}
        onClick={(event) => run("file", event.currentTarget.ownerDocument)}
      >
        {busy ? <Spinner size="sm" /> : <DownloadIcon className="size-3.5" />}
        Download
      </Button>
    );
  }

  // Plain markup, not a Base UI menu: those portal into the main window, which a popped-out window is not.
  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <Button
        type="button"
        size="xs"
        variant={open ? "secondary" : "outline"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
      >
        {busy ? <Spinner size="sm" /> : <DownloadIcon className="size-3.5" />}
        Download
        <ChevronDown className="size-3" />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1 flex w-36 flex-col gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {(
            [
              ["file", "HTML"],
              ["png", "PNG image"],
              ["pdf", "PDF"],
            ] as const
          ).map(([format, text]) => (
            <Button
              key={format}
              type="button"
              role="menuitem"
              size="xs"
              variant="ghost"
              className="justify-start"
              onClick={(event) => run(format, event.currentTarget.ownerDocument)}
            >
              {text}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
