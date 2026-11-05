import { STUDIO_PIN_MODE_MESSAGE } from "@t3tools/shared/studioZoom";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import {
  fractionsOverlayPoint,
  isStudioPinExitMessage,
  overlayPointFractions,
  parseStudioPickPointMessage,
  parseStudioScrollMessage,
  pickPointFractions,
  pinOverlayPoint,
  popoverOrigin,
  type Point,
  type Size,
  type StudioPin,
  type StudioPinDraft,
  type StudioScroll,
} from "./studioPins";

const POPOVER_SIZE = { width: 224, height: 124 } as const;

function PinMarker(props: {
  readonly label: number | null;
  readonly point: Point;
  readonly dim?: boolean;
}) {
  return (
    <span
      className={cn(
        "absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary font-semibold text-3xs text-primary-foreground shadow-md ring-2 ring-background",
        props.dim && "opacity-50",
      )}
      style={{ left: props.point.x, top: props.point.y }}
    >
      {props.label ?? "+"}
    </span>
  );
}

function PinPopover(props: {
  readonly origin: Point;
  readonly onSubmit: (comment: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const empty = text.trim().length === 0;
  const submit = () => {
    if (!empty) props.onSubmit(text.trim());
  };
  return (
    <div
      role="dialog"
      aria-label="Comment on this spot"
      className="pointer-events-auto absolute flex flex-col gap-1.5 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
      style={{ left: props.origin.x, top: props.origin.y, width: POPOVER_SIZE.width }}
    >
      <Textarea
        size="sm"
        autoFocus
        aria-label="Pin comment"
        placeholder="What should change here?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit();
        }}
      />
      <div className="flex justify-end gap-1">
        <Button type="button" size="xs" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="button" size="xs" disabled={empty} onClick={submit}>
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * Pins over one design. A page that runs the injected bridge reports its scroll and answers pin
 * clicks, so pins anchor to the page and follow it; without the bridge (old server, oversized
 * file, images, text) a transparent overlay takes the click and pins stay on the visible area.
 */
export function StudioPinLayer(props: {
  readonly pins: readonly StudioPin[];
  readonly size: Size | null;
  readonly zoom: number;
  readonly pinMode: boolean;
  readonly pane: 0 | 1;
  readonly draft: StudioPinDraft | null;
  readonly onDraft: (draft: StudioPinDraft) => void;
  readonly onSubmit: (comment: string) => void;
  readonly onCancel: () => void;
  readonly onEscape: () => void;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState<StudioScroll | null>(null);
  const scrollRef = useRef<StudioScroll | null>(null);
  const announcedTo = useRef<Window | null>(null);

  const frameWindow = useStableCallback(
    () => root?.parentElement?.querySelector("iframe")?.contentWindow ?? null,
  );
  const postPinMode = useStableCallback((on: boolean) => {
    const target = frameWindow();
    if (target === null) return;
    announcedTo.current = on ? target : null;
    target.postMessage({ type: STUDIO_PIN_MODE_MESSAGE, on }, "*");
  });

  const place = useStableCallback((point: Point, page: StudioPinDraft["page"]) => {
    props.onDraft({ pane: props.pane, fx: point.x, fy: point.y, page });
  });
  const handleMessage = useStableCallback((event: MessageEvent) => {
    const source = frameWindow();
    if (source === null || event.source !== source) return;
    const report = parseStudioScrollMessage(event.data);
    if (report !== null) {
      scrollRef.current = report;
      setScroll(report);
      // A reloaded page starts out of pin mode, so tell its fresh bridge.
      if (props.pinMode && announcedTo.current !== source) postPinMode(true);
      return;
    }
    if (isStudioPinExitMessage(event.data)) {
      if (props.pinMode) props.onEscape();
      return;
    }
    const pick = parseStudioPickPointMessage(event.data);
    if (pick === null || !props.pinMode || props.size === null) return;
    const latest = scrollRef.current;
    place(
      latest === null
        ? {
            x: Math.min(1, Math.max(0, (pick.x * props.zoom) / props.size.width)),
            y: Math.min(1, Math.max(0, (pick.y * props.zoom) / props.size.height)),
          }
        : pickPointFractions(pick, latest),
      latest === null
        ? null
        : {
            x: pick.pageX,
            y: pick.pageY,
            width: latest.scrollWidth,
            height: latest.scrollHeight,
            selector: pick.selector,
            text: pick.text,
          },
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the sandboxed frame's messages on the window that owns this element
  useEffect(() => {
    const owner = root?.ownerDocument.defaultView;
    if (!owner) return;
    owner.addEventListener("message", handleMessage);
    return () => owner.removeEventListener("message", handleMessage);
  }, [root, handleMessage]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the sandboxed frame's bridge whether clicks are pins
  useEffect(() => {
    if (root !== null) postPinMode(props.pinMode);
  }, [root, props.pinMode, postPinMode]);

  const box = props.size;
  const view = box === null ? null : { zoom: props.zoom, box, scroll };
  const draftPoint =
    box === null || view === null || props.draft === null
      ? null
      : (pinOverlayPoint(props.draft, view) ??
        fractionsOverlayPoint({ x: props.draft.fx, y: props.draft.fy }, box));

  return (
    <div ref={setRoot} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {view === null
        ? null
        : props.pins.map((pin) => {
            const point = pinOverlayPoint(pin, view);
            return point === null ? null : (
              <PinMarker
                key={pin.id}
                label={pin.number}
                point={point}
                dim={pin.page !== null && Math.abs(pin.zoom - props.zoom) > 0.01}
              />
            );
          })}
      {props.pinMode && scroll === null ? (
        <div
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
          data-studio-pin-overlay
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            place(
              overlayPointFractions(
                { x: event.clientX - rect.left, y: event.clientY - rect.top },
                rect,
              ),
              null,
            );
          }}
        />
      ) : null}
      {box !== null && props.draft !== null && draftPoint !== null ? (
        <>
          <PinMarker label={null} point={draftPoint} />
          <PinPopover
            origin={popoverOrigin(draftPoint, POPOVER_SIZE, box)}
            onSubmit={props.onSubmit}
            onCancel={props.onCancel}
          />
        </>
      ) : null}
    </div>
  );
}
