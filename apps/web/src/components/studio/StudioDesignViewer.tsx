import { Maximize2, Minus, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "~/components/ui/button";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";

import { FileSurfaceAction } from "../files/fileSurfaceChrome";
import { type StudioManifest, type StudioVariant, studioVariantKind } from "./studioManifest";
import {
  fitImageZoom,
  fitPageZoom,
  parseStudioWheelZoomMessage,
  stepZoom,
  wheelZoom,
  zoomPercent,
} from "./studioZoom";
import { type StudioContext, StudioVariantPreview } from "./StudioVariantPreview";

type Size = { readonly width: number; readonly height: number };

// Base UI portals tooltips into the main window, so a popped-out window uses native titles.
function StudioAction(props: {
  readonly label: string;
  readonly native: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return props.native ? (
    <Button
      type="button"
      className="shrink-0"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled ?? false}
      onClick={props.onPress}
    >
      {props.children}
    </Button>
  ) : (
    <FileSurfaceAction
      label={props.label}
      disabled={props.disabled ?? false}
      onPress={props.onPress}
    >
      {props.children}
    </FileSurfaceAction>
  );
}

function StudioZoomControls(props: {
  readonly zoom: number;
  readonly fit: boolean;
  readonly native: boolean;
  readonly onZoomChange: (zoom: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <StudioAction
        label="Zoom out"
        native={props.native}
        disabled={stepZoom(props.zoom, -1) === props.zoom}
        onPress={() => props.onZoomChange(stepZoom(props.zoom, -1))}
      >
        <Minus className="size-3.5" />
      </StudioAction>
      <span className="min-w-9 text-center text-xs tabular-nums">{zoomPercent(props.zoom)}</span>
      <StudioAction
        label="Zoom in"
        native={props.native}
        disabled={stepZoom(props.zoom, 1) === props.zoom}
        onPress={() => props.onZoomChange(stepZoom(props.zoom, 1))}
      >
        <Plus className="size-3.5" />
      </StudioAction>
      <Button
        type="button"
        size="xs"
        variant={props.fit ? "secondary" : "ghost"}
        aria-pressed={props.fit}
        onClick={() => props.onZoomChange(null)}
      >
        Fit
      </Button>
    </div>
  );
}

/**
 * One design with its toolbar. `zoom` is null while fitting, so Fit follows the container as it
 * resizes; a number is a fixed browser-style zoom owned by the caller so it survives remounts.
 */
export function StudioDesignStage(
  props: StudioContext & {
    readonly setPath: string;
    readonly manifest: StudioManifest;
    readonly variant: StudioVariant;
    readonly zoom: number | null;
    readonly onZoomChange: (zoom: number | null) => void;
    readonly saving: boolean;
    readonly onSelect: (id: string) => void;
    readonly onTogglePick: () => void;
    readonly leading?: ReactNode;
    readonly trailing?: ReactNode;
    readonly onFullscreen?: () => void;
    readonly onExitFullscreen?: () => void;
    readonly onPopOut?: () => void;
    /** Rendering into a popped-out window. */
    readonly native?: boolean;
  },
) {
  const kind = studioVariantKind(props.variant.file);
  const zoomable = kind === "html" || kind === "image";
  const native = props.native ?? false;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [image, setImage] = useState<(Size & { readonly file: string }) | null>(null);

  const imageSize = image?.file === props.variant.file ? image : null;
  const fitZoom =
    size === null
      ? 1
      : kind === "image"
        ? imageSize === null
          ? 1
          : fitImageZoom(size, imageSize)
        : fitPageZoom(size.width);
  const zoom = props.zoom ?? fitZoom;
  const latestZoom = useRef(zoom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gesture events can outpace renders, so they accumulate on this ref
  useEffect(() => {
    latestZoom.current = zoom;
  });
  const zoomBy = useStableCallback((deltaY: number, deltaMode: number) => {
    const next = wheelZoom(latestZoom.current, deltaY, deltaMode);
    latestZoom.current = next;
    props.onZoomChange(next);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the frame element, which may live in another window
  useEffect(() => {
    if (frame === null) return;
    return observeResize(frame, () =>
      setSize({ width: frame.clientWidth, height: frame.clientHeight }),
    );
  }, [frame]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to wheel and iframe messages on the window that owns this element
  useEffect(() => {
    if (root === null || frame === null || !zoomable) return;
    const owner = root.ownerDocument.defaultView;
    if (owner === null) return;
    // React's wheel listeners are passive, which cannot stop the browser zooming the whole app.
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoomBy(event.deltaY, event.deltaMode);
    };
    // The design is a cross-origin frame; its injected bridge posts the gestures it sees.
    const onMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.querySelector("iframe")?.contentWindow) {
        return;
      }
      const message = parseStudioWheelZoomMessage(event.data);
      if (message !== null) zoomBy(message.deltaY, message.deltaMode);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    owner.addEventListener("message", onMessage);
    return () => {
      root.removeEventListener("wheel", onWheel);
      owner.removeEventListener("message", onMessage);
    };
  }, [root, frame, zoomable, zoomBy]);

  const view = zoomable
    ? {
        zoom,
        fit: props.zoom === null,
        imageSize,
        onImageSize: (next: Size) =>
          setImage((current) =>
            current?.file === props.variant.file &&
            current.width === next.width &&
            current.height === next.height
              ? current
              : { ...next, file: props.variant.file },
          ),
      }
    : undefined;
  const preview = (
    <StudioVariantPreview {...props} variant={props.variant} thumbnail={false} view={view} />
  );

  return (
    <div ref={setRoot} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        {props.leading}
        {props.manifest.variants.map((variant) => (
          <Button
            key={variant.id}
            type="button"
            size="xs"
            variant={variant.id === props.variant.id ? "secondary" : "ghost"}
            aria-pressed={variant.id === props.variant.id}
            onClick={() => props.onSelect(variant.id)}
          >
            {variant.id}
          </Button>
        ))}
        <div className="min-w-0 flex-1" />
        {zoomable ? (
          <StudioZoomControls
            zoom={zoom}
            fit={props.zoom === null}
            native={native}
            onZoomChange={props.onZoomChange}
          />
        ) : null}
        <Button
          type="button"
          size="xs"
          variant={props.manifest.picked === props.variant.id ? "default" : "outline"}
          aria-pressed={props.manifest.picked === props.variant.id}
          disabled={props.saving}
          onClick={props.onTogglePick}
        >
          {props.manifest.picked === props.variant.id ? "Picked" : "Pick"}
        </Button>
        {props.onFullscreen ? (
          <StudioAction label="Full screen" native={native} onPress={props.onFullscreen}>
            <Maximize2 className="size-3.5" />
          </StudioAction>
        ) : null}
        {props.onPopOut ? (
          <StudioAction label="Open in new window" native={native} onPress={props.onPopOut}>
            <SquareArrowOutUpRight className="size-3.5" />
          </StudioAction>
        ) : null}
        {props.trailing}
        {props.onExitFullscreen ? (
          <StudioAction label="Exit full screen" native={native} onPress={props.onExitFullscreen}>
            <X className="size-3.5" />
          </StudioAction>
        ) : null}
      </div>
      <div
        ref={setFrame}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      >
        {kind === "html" ? (
          size === null ? null : (
            <div
              className="absolute top-0 left-0 flex origin-top-left flex-col"
              style={{
                width: size.width / zoom,
                height: size.height / zoom,
                transform: `scale(${zoom})`,
              }}
            >
              {preview}
            </div>
          )
        ) : (
          preview
        )}
      </div>
    </div>
  );
}

export function StudioFullscreen(props: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const { onClose } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Esc exits full screen; the listener lives on the window
  useEffect(() => {
    // Capture and stop it, or the app's own Esc handling also closes the side panel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-label="Design full screen"
      className="fixed inset-0 z-[90] flex flex-col bg-background text-foreground"
    >
      {props.children}
    </div>,
    document.body,
  );
}

function copyAttributes(from: Element, to: Element) {
  for (const name of to.getAttributeNames()) {
    if (!from.hasAttribute(name)) to.removeAttribute(name);
  }
  for (const name of from.getAttributeNames()) {
    const value = from.getAttribute(name);
    if (value !== null && to.getAttribute(name) !== value) to.setAttribute(name, value);
  }
}

/** Gives a blank popup the app's stylesheets and theme attributes before React renders into it. */
export function preparePopupDocument(popup: Window, title: string) {
  const target = popup.document;
  target.title = title;
  target.head.replaceChildren();
  for (const node of document.head.querySelectorAll('link[rel~="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = node.href;
      target.head.append(link);
    } else {
      target.head.append(node.cloneNode(true));
    }
  }
  copyAttributes(document.documentElement, target.documentElement);
  copyAttributes(document.body, target.body);
  target.body.replaceChildren();
}

function setPopupTitle(popup: Window, title: string) {
  popup.document.title = title;
}

export function StudioPopupWindow(props: {
  readonly popup: Window;
  readonly title: string;
  readonly onClosed: () => void;
  readonly children: ReactNode;
}) {
  const { popup, onClosed } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- popup.document.title is outside React
  useEffect(() => setPopupTitle(popup, props.title), [popup, props.title]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- detects the OS closing the popup and keeps its theme in step with the app
  useEffect(() => {
    popup.addEventListener("pagehide", onClosed);
    // pagehide does not fire for every way a window can go away.
    const timer = setInterval(() => {
      if (popup.closed) onClosed();
    }, 1000);
    const observer = new MutationObserver(() => {
      copyAttributes(document.documentElement, popup.document.documentElement);
      copyAttributes(document.body, popup.document.body);
    });
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    return () => {
      popup.removeEventListener("pagehide", onClosed);
      clearInterval(timer);
      observer.disconnect();
    };
  }, [popup, onClosed]);

  return createPortal(
    <div className="flex h-screen flex-col bg-background text-foreground">{props.children}</div>,
    popup.document.body,
  );
}
