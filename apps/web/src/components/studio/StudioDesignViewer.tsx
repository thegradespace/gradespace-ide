import {
  Columns2,
  Crosshair,
  Maximize2,
  Minus,
  Plus,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "~/components/ui/button";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

import { FileSurfaceAction } from "../files/fileSurfaceChrome";
import {
  type StudioManifest,
  type StudioVariant,
  studioLatestVersion,
  studioShownVariant,
  studioVariantKind,
  studioViewedVersion,
  type StudioViewedVersion,
} from "./studioManifest";
import type { NewStudioPin, Size, StudioPin, StudioPinDraft } from "./studioPins";
import { StudioPinLayer } from "./StudioPinLayer";
import { StudioShareButton } from "./StudioShareButton";
import {
  fitImageZoom,
  fitPageZoom,
  parseStudioWheelZoomMessage,
  stepZoom,
  wheelZoom,
  zoomPercent,
} from "./studioZoom";
import { type StudioContext, type StudioView, StudioVariantPreview } from "./StudioVariantPreview";

// Base UI portals tooltips into the main window, so a popped-out window uses native titles.
function StudioAction(props: {
  readonly label: string;
  readonly native: boolean;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return props.native ? (
    <Button
      type="button"
      className="shrink-0"
      variant={props.pressed ? "secondary" : "ghost"}
      size="icon-sm"
      aria-label={props.label}
      aria-pressed={props.pressed}
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
      {...(props.pressed === undefined ? {} : { pressed: props.pressed })}
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

type PaneFrame = ReturnType<typeof usePaneFrame>;

/**
 * Sizing for one design. `zoom` is null while fitting, so Fit follows the container as it
 * resizes; a number is a fixed browser-style zoom owned by the caller so it survives remounts.
 */
function usePaneFrame(variant: StudioVariant | null, zoomSetting: number | null) {
  const file = variant?.file ?? "";
  const kind = variant === null ? "other" : studioVariantKind(file);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [image, setImage] = useState<(Size & { readonly file: string }) | null>(null);
  const imageSize = image?.file === file ? image : null;
  const fitZoom =
    size === null
      ? 1
      : kind === "image"
        ? imageSize === null
          ? 1
          : fitImageZoom(size, imageSize)
        : fitPageZoom(size.width);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the frame element, which may live in another window
  useEffect(() => {
    if (frame === null) return;
    return observeResize(frame, () =>
      setSize({ width: frame.clientWidth, height: frame.clientHeight }),
    );
  }, [frame]);
  const zoomable = kind === "html" || kind === "image";
  const zoom = zoomSetting ?? fitZoom;
  const view: StudioView | undefined = zoomable
    ? {
        zoom,
        fit: zoomSetting === null,
        imageSize,
        onImageSize: (next) =>
          setImage((current) =>
            current?.file === file && current.width === next.width && current.height === next.height
              ? current
              : { ...next, file },
          ),
      }
    : undefined;
  return { kind, zoomable, setFrame, size, zoom, view };
}

type VersionProps = {
  /** Earlier versions being viewed, by option id; an option not listed shows its latest. */
  readonly versions: Readonly<Record<string, number>>;
  readonly onVersionChange: (variantId: string, version: StudioViewedVersion) => void;
  readonly onRestore: (variant: StudioVariant, version: number) => void;
};

/** Switches an option between its versions; older ones are read-only and can be restored. */
function StudioVersionBar(
  props: Pick<VersionProps, "onRestore"> & {
    readonly variant: StudioVariant;
    readonly version: StudioViewedVersion;
    readonly onVersionChange: (version: StudioViewedVersion) => void;
  },
) {
  const { variant, version } = props;
  const latest = studioLatestVersion(variant);
  if (latest === 1) return null;
  return (
    <div
      role="group"
      aria-label={`Versions of option ${variant.id}`}
      className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1"
    >
      {Array.from({ length: latest }, (_, index) => index + 1).map((number) => {
        const isLatest = number === latest;
        const revision = variant.revisions?.[number - 1];
        return (
          <Button
            key={number}
            type="button"
            size="xs"
            variant={(version ?? latest) === number ? "secondary" : "ghost"}
            aria-pressed={(version ?? latest) === number}
            title={revision?.note}
            onClick={() => props.onVersionChange(isLatest ? null : number)}
          >
            {isLatest ? `v${number} (latest)` : `v${number}`}
          </Button>
        );
      })}
      {version === null ? null : (
        <>
          <span className="text-muted-foreground text-xs">
            Viewing v{version} of {variant.id}
          </span>
          <div className="min-w-0 flex-1" />
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => props.onRestore(variant, version)}
          >
            Restore this version
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => props.onVersionChange(null)}
          >
            Back to latest
          </Button>
        </>
      )}
    </div>
  );
}

type PinProps = {
  readonly pins: readonly StudioPin[];
  readonly pinMode: boolean;
  readonly pinDraft: StudioPinDraft | null;
  readonly onDraft: (draft: StudioPinDraft) => void;
  readonly onSubmitDraft: (comment: string) => void;
  readonly onCancelDraft: () => void;
  readonly onEscape: () => void;
};

function StudioPane(
  props: StudioContext &
    PinProps &
    Pick<VersionProps, "onRestore"> & {
      readonly setPath: string;
      readonly variant: StudioVariant;
      readonly version: StudioViewedVersion;
      readonly onVersionChange: (version: StudioViewedVersion) => void;
      readonly paneFrame: PaneFrame;
      readonly pane: 0 | 1;
      readonly header?: ReactNode;
      readonly separator?: "left" | "top" | undefined;
    },
) {
  const { size, zoom, kind, view, setFrame } = props.paneFrame;
  const preview = (
    <StudioVariantPreview
      {...props}
      variant={studioShownVariant(props.variant, props.version)}
      thumbnail={false}
      view={view}
    />
  );
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        props.separator === "left" && "border-l",
        props.separator === "top" && "border-t",
      )}
    >
      {props.header}
      <StudioVersionBar
        variant={props.variant}
        version={props.version}
        onVersionChange={props.onVersionChange}
        onRestore={props.onRestore}
      />
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
        <StudioPinLayer
          key={`${props.variant.id}:${props.version ?? "latest"}`}
          pins={props.pins}
          size={size}
          zoom={zoom}
          pinMode={props.pinMode}
          pane={props.pane}
          draft={props.pinDraft}
          onDraft={props.onDraft}
          onSubmit={props.onSubmitDraft}
          onCancel={props.onCancelDraft}
          onEscape={props.onEscape}
        />
      </div>
    </div>
  );
}

function StudioPaneHeader(props: {
  readonly manifest: StudioManifest;
  readonly variant: StudioVariant;
  readonly saving: boolean;
  readonly label: string;
  readonly share: ReactNode;
  readonly onSelect: (id: string) => void;
  readonly onTogglePick: () => void;
}) {
  const picked = props.manifest.picked === props.variant.id;
  return (
    <div
      role="group"
      aria-label={props.label}
      className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1"
    >
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
      {props.share}
      <Button
        type="button"
        size="xs"
        variant={picked ? "default" : "outline"}
        aria-pressed={picked}
        disabled={props.saving}
        onClick={props.onTogglePick}
      >
        {picked ? "Picked" : "Pick"}
      </Button>
    </div>
  );
}

// Side by side needs room for two readable pages.
const STACK_BELOW_WIDTH = 640;

/**
 * One design, or two when comparing, under one toolbar. Zoom is shared by both panes, and pin
 * mode applies to whichever pane is clicked.
 */
export function StudioDesignStage(
  props: StudioContext &
    VersionProps & {
      readonly setPath: string;
      readonly manifest: StudioManifest;
      readonly variant: StudioVariant;
      /** The option in the second pane while comparing. */
      readonly compare: StudioVariant | null;
      readonly onCompareChange: (on: boolean) => void;
      readonly zoom: number | null;
      readonly onZoomChange: (zoom: number | null) => void;
      readonly saving: boolean;
      readonly onSelect: (id: string) => void;
      readonly onSelectCompare: (id: string) => void;
      readonly onTogglePick: (variant: StudioVariant) => void;
      readonly pinMode: boolean;
      readonly onPinModeChange: (on: boolean) => void;
      readonly pins: readonly StudioPin[];
      readonly onAddPin: (pin: NewStudioPin) => void;
      readonly leading?: ReactNode;
      readonly trailing?: ReactNode;
      readonly onFullscreen?: () => void;
      readonly onExitFullscreen?: () => void;
      readonly onPopOut?: () => void;
      /** Rendering into a popped-out window. */
      readonly native?: boolean;
    },
) {
  const native = props.native ?? false;
  const compare = props.compare;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [rootWidth, setRootWidth] = useState<number | null>(null);
  const [draft, setDraft] = useState<StudioPinDraft | null>(null);
  const leadVersion = studioViewedVersion(props.variant, props.versions[props.variant.id]);
  const compareVersion =
    compare === null ? null : studioViewedVersion(compare, props.versions[compare.id]);
  const lead = usePaneFrame(studioShownVariant(props.variant, leadVersion), props.zoom);
  const second = usePaneFrame(
    compare === null ? null : studioShownVariant(compare, compareVersion),
    props.zoom,
  );
  const zoomed = lead.zoomable ? lead : compare !== null && second.zoomable ? second : null;
  const zoom = zoomed?.zoom ?? 1;
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the root element, which may live in another window
  useEffect(() => {
    if (root === null) return;
    return observeResize(root, () => setRootWidth(root.clientWidth));
  }, [root]);
  const stacked = rootWidth !== null && rootWidth < STACK_BELOW_WIDTH;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to wheel and iframe messages on the window that owns this element
  useEffect(() => {
    if (root === null || zoomed === null) return;
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
      if (
        event.source === null ||
        !Array.from(root.querySelectorAll("iframe")).some(
          (frame) => frame.contentWindow === event.source,
        )
      ) {
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
  }, [root, zoomed, zoomBy]);

  const activeDraft = props.pinMode && (draft?.pane !== 1 || compare !== null) ? draft : null;
  const escapePin = useStableCallback(() => {
    if (activeDraft !== null) setDraft(null);
    else props.onPinModeChange(false);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Esc leaves pin mode; the listener lives on the window that owns this element
  useEffect(() => {
    const owner = root?.ownerDocument.defaultView;
    if (!owner || !props.pinMode) return;
    // Capture and stop it, or the app's own Esc handling also closes the side panel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      escapePin();
    };
    owner.addEventListener("keydown", onKeyDown, { capture: true });
    return () => owner.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [root, props.pinMode, escapePin]);

  const submitDraft = (comment: string) => {
    if (activeDraft === null) return;
    const variant = activeDraft.pane === 0 ? props.variant : compare;
    if (variant === null) return;
    props.onAddPin({
      variantId: variant.id,
      version: activeDraft.pane === 0 ? leadVersion : compareVersion,
      comment,
      fx: activeDraft.fx,
      fy: activeDraft.fy,
      page: activeDraft.page,
      zoom,
    });
    setDraft(null);
  };
  const pinProps = {
    pinMode: props.pinMode,
    onDraft: setDraft,
    onSubmitDraft: submitDraft,
    onCancelDraft: () => setDraft(null),
    onEscape: escapePin,
  };
  const changeVersion = (variantId: string, version: StudioViewedVersion) => {
    setDraft(null);
    props.onVersionChange(variantId, version);
  };
  const paneContext = {
    environmentId: props.environmentId,
    cwd: props.cwd,
    threadRef: props.threadRef,
    draft: props.draft,
    workspaceMutationId: props.workspaceMutationId,
    setPath: props.setPath,
  };
  const picked = props.manifest.picked === props.variant.id;
  // Compare has one toolbar per option, so each pane shares its own option at the version it shows.
  const shareButton = (variant: StudioVariant, version: StudioViewedVersion) => (
    <StudioShareButton
      environmentId={props.environmentId}
      cwd={props.cwd}
      setPath={props.setPath}
      variant={studioShownVariant(variant, version)}
      optionLabel={compare === null ? undefined : variant.id}
      native={native}
    />
  );

  return (
    <div ref={setRoot} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        {props.leading}
        {compare === null
          ? props.manifest.variants.map((variant) => (
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
            ))
          : null}
        <div className="min-w-0 flex-1" />
        <StudioAction
          label="Comment on a spot"
          native={native}
          pressed={props.pinMode}
          onPress={() => props.onPinModeChange(!props.pinMode)}
        >
          <Crosshair className="size-3.5" />
        </StudioAction>
        <StudioAction
          label="Compare side by side"
          native={native}
          pressed={compare !== null}
          disabled={props.manifest.variants.length < 2}
          onPress={() => props.onCompareChange(compare === null)}
        >
          <Columns2 className="size-3.5" />
        </StudioAction>
        {zoomed !== null ? (
          <StudioZoomControls
            zoom={zoom}
            fit={props.zoom === null}
            native={native}
            onZoomChange={props.onZoomChange}
          />
        ) : null}
        {compare === null ? shareButton(props.variant, leadVersion) : null}
        {compare === null ? (
          <Button
            type="button"
            size="xs"
            variant={picked ? "default" : "outline"}
            aria-pressed={picked}
            disabled={props.saving}
            onClick={() => props.onTogglePick(props.variant)}
          >
            {picked ? "Picked" : "Pick"}
          </Button>
        ) : null}
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
      <div className={cn("flex min-h-0 flex-1", stacked ? "flex-col" : "flex-row")}>
        <StudioPane
          key="lead"
          {...paneContext}
          {...pinProps}
          variant={props.variant}
          version={leadVersion}
          onVersionChange={(version) => changeVersion(props.variant.id, version)}
          onRestore={props.onRestore}
          paneFrame={lead}
          pane={0}
          pins={props.pins.filter(
            (pin) => pin.variantId === props.variant.id && pin.version === leadVersion,
          )}
          pinDraft={activeDraft?.pane === 0 ? activeDraft : null}
          header={
            compare === null ? undefined : (
              <StudioPaneHeader
                manifest={props.manifest}
                variant={props.variant}
                saving={props.saving}
                label="Left option"
                share={shareButton(props.variant, leadVersion)}
                onSelect={props.onSelect}
                onTogglePick={() => props.onTogglePick(props.variant)}
              />
            )
          }
        />
        {compare === null ? null : (
          <StudioPane
            key="second"
            {...paneContext}
            {...pinProps}
            variant={compare}
            version={compareVersion}
            onVersionChange={(version) => changeVersion(compare.id, version)}
            onRestore={props.onRestore}
            paneFrame={second}
            pane={1}
            separator={stacked ? "top" : "left"}
            pins={props.pins.filter(
              (pin) => pin.variantId === compare.id && pin.version === compareVersion,
            )}
            pinDraft={activeDraft?.pane === 1 ? activeDraft : null}
            header={
              <StudioPaneHeader
                manifest={props.manifest}
                variant={compare}
                saving={props.saving}
                label="Right option"
                share={shareButton(compare, compareVersion)}
                onSelect={props.onSelectCompare}
                onTogglePick={() => props.onTogglePick(compare)}
              />
            }
          />
        )}
      </div>
    </div>
  );
}

export function StudioFullscreen(props: {
  readonly onClose: () => void;
  /** Something inside owns Esc, such as pin mode. */
  readonly busy: boolean;
  readonly children: ReactNode;
}) {
  const { onClose, busy } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Esc exits full screen; the listener lives on the window
  useEffect(() => {
    // Capture and stop it, or the app's own Esc handling also closes the side panel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || busy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose, busy]);
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
