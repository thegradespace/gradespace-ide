import { STUDIO_SCROLL_TO_MESSAGE } from "@t3tools/shared/studioZoom";
import { ChevronsLeftRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import {
  type CompareLayer,
  dividerForKey,
  dividerForPointer,
  EMPTY_SCROLL_SYNC,
  type ScrollSyncState,
  syncScrollReport,
} from "./studioCompare.logic";
import { parseStudioScrollMessage, type Size } from "./studioPins";
import { STUDIO_PAGE_WIDTHS, type StudioPageWidth } from "./studioZoom";

const ALL_SIZES_PADDING = 12;
const ALL_SIZES_GAP = 12;
const ALL_SIZES_LABEL = 20;
/** Screen pixels around and between the three pages, which do not scale with zoom. */
export const ALL_SIZES_CHROME = ALL_SIZES_PADDING * 2 + ALL_SIZES_GAP * 2;

export const STUDIO_WIDTH_LABELS: Readonly<Record<StudioPageWidth, string>> = {
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
};

function ScaledBox(props: {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="absolute top-0 left-0 flex origin-top-left flex-col"
      style={{ width: props.width, height: props.height, transform: `scale(${props.zoom})` }}
    >
      {props.children}
    </div>
  );
}

/**
 * One page scaled by `zoom`. Desktop (`width` null) lays out at the frame's width over the zoom,
 * like a browser; a phone or tablet width stays fixed and sits centred, scrolling sideways when
 * zoomed past the frame.
 */
export function StudioScaledPage(props: {
  readonly size: Size;
  readonly zoom: number;
  readonly width: number | null;
  readonly children: ReactNode;
}) {
  const { size, zoom, width } = props;
  if (width === null) {
    return (
      <ScaledBox width={size.width / zoom} height={size.height / zoom} zoom={zoom}>
        {props.children}
      </ScaledBox>
    );
  }
  return (
    <div className="absolute inset-0 overflow-x-auto overflow-y-hidden bg-muted/40">
      <div
        className="relative mx-auto h-full overflow-hidden bg-background shadow-sm ring-1 ring-border"
        style={{ width: width * zoom }}
      >
        <ScaledBox width={width} height={size.height / zoom} zoom={zoom}>
          {props.children}
        </ScaledBox>
      </div>
    </div>
  );
}

/** Phone, tablet and desktop side by side at one zoom, so their real sizes compare. */
export function StudioAllSizes(props: {
  readonly size: Size;
  readonly zoom: number;
  readonly children: ReactNode;
}) {
  const { size, zoom } = props;
  const height = Math.max(0, size.height - ALL_SIZES_PADDING * 2 - ALL_SIZES_LABEL);
  return (
    <div className="scrollbar-gutter-both absolute inset-0 overflow-auto bg-muted/40">
      <div
        className="mx-auto flex w-max"
        style={{ padding: ALL_SIZES_PADDING, gap: ALL_SIZES_GAP }}
      >
        {(Object.keys(STUDIO_PAGE_WIDTHS) as StudioPageWidth[]).map((name) => {
          const width = STUDIO_PAGE_WIDTHS[name];
          return (
            <section
              key={name}
              aria-label={`${STUDIO_WIDTH_LABELS[name]}, ${width} pixels wide`}
              className="flex shrink-0 flex-col"
            >
              <span
                className="truncate text-muted-foreground text-xs"
                style={{ height: ALL_SIZES_LABEL, width: width * zoom }}
              >
                {STUDIO_WIDTH_LABELS[name]} · {width}
              </span>
              <div
                className="relative overflow-hidden bg-background shadow-sm ring-1 ring-border"
                style={{ width: width * zoom, height }}
              >
                <ScaledBox width={width} height={height / zoom} zoom={zoom}>
                  {props.children}
                </ScaledBox>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const layerSelector = (layer: CompareLayer) => `[data-compare-layer="${layer}"]`;

/** The element in `to` at the same child path as `node` has in `from`. */
function matchingElement(from: Element, to: Element, node: Element): Element | null {
  const path: number[] = [];
  for (let current: Element | null = node; current !== from; current = current.parentElement) {
    if (current === null || current.parentElement === null) return null;
    path.unshift(Array.prototype.indexOf.call(current.parentElement.children, current) as number);
  }
  let target: Element | undefined = to;
  for (const index of path) {
    target = target?.children[index];
  }
  return target ?? null;
}

/**
 * An earlier version over the latest, split by a divider. Both layers lay out the same way, so
 * zoom matches; scrolling either one scrolls the other, through the page bridge for designs.
 */
export function StudioVersionSlider(props: {
  readonly before: ReactNode;
  readonly after: ReactNode;
  readonly beforeLabel: string;
  readonly afterLabel: string;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(50);
  const dragging = useRef(false);
  const sync = useRef<ScrollSyncState>(EMPTY_SCROLL_SYNC);
  const domSync = useRef<ScrollSyncState>(EMPTY_SCROLL_SYNC);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the two layers' scroll in step: frame bridge messages and native scroll events
  useEffect(() => {
    if (root === null) return;
    const owner = root.ownerDocument.defaultView;
    if (owner === null) return;
    const layer = (index: CompareLayer) => root.querySelector(layerSelector(index));
    const frameWindow = (index: CompareLayer) =>
      layer(index)?.querySelector("iframe")?.contentWindow ?? null;
    const onMessage = (event: MessageEvent) => {
      if (event.source === null) return;
      const from: CompareLayer | null =
        event.source === frameWindow(0) ? 0 : event.source === frameWindow(1) ? 1 : null;
      if (from === null) return;
      const report = parseStudioScrollMessage(event.data);
      if (report === null) return;
      const next = syncScrollReport(sync.current, from, report);
      sync.current = next.state;
      if (next.forward === null) return;
      frameWindow(from === 0 ? 1 : 0)?.postMessage(
        { type: STUDIO_SCROLL_TO_MESSAGE, x: next.forward.x, y: next.forward.y },
        "*",
      );
    };
    // Images and the sideways scroll of a narrow page scroll in this document.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof owner.Element)) return;
      const from = target.closest("[data-compare-layer]");
      const fromIndex = from?.getAttribute("data-compare-layer");
      const to = fromIndex === "0" ? layer(1) : fromIndex === "1" ? layer(0) : null;
      if (!from || !to) return;
      const other = matchingElement(from, to, target);
      if (other === null) return;
      // Already level: nothing to send, and no echo would come back to clear a pending entry.
      if (other.scrollLeft === target.scrollLeft && other.scrollTop === target.scrollTop) return;
      const next = syncScrollReport(domSync.current, fromIndex === "0" ? 0 : 1, {
        scrollX: target.scrollLeft,
        scrollY: target.scrollTop,
        scrollWidth: target.scrollWidth,
        scrollHeight: target.scrollHeight,
        innerWidth: target.clientWidth,
        innerHeight: target.clientHeight,
      });
      domSync.current = next.state;
      if (next.forward === null) return;
      other.scrollLeft = next.forward.x;
      other.scrollTop = next.forward.y;
    };
    owner.addEventListener("message", onMessage);
    root.addEventListener("scroll", onScroll, { capture: true });
    return () => {
      owner.removeEventListener("message", onMessage);
      root.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [root]);

  const moveTo = (clientX: number) => {
    if (root !== null) setPosition(dividerForPointer(clientX, root.getBoundingClientRect()));
  };
  const rounded = Math.round(position);
  const chip =
    "pointer-events-none absolute top-2 z-20 rounded-md bg-background/90 px-1.5 py-0.5 text-foreground text-xs shadow-sm ring-1 ring-border";

  return (
    <div ref={setRoot} className="absolute inset-0 overflow-hidden">
      <div data-compare-layer="1" className="absolute inset-0 flex flex-col bg-background">
        {props.after}
      </div>
      <div
        data-compare-layer="0"
        className="absolute inset-0 flex flex-col bg-background"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {props.before}
      </div>
      <span className={cn(chip, "left-2")}>{props.beforeLabel}</span>
      <span className={cn(chip, "right-2")}>{props.afterLabel}</span>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Divider between ${props.beforeLabel} and ${props.afterLabel}`}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${rounded}% ${props.beforeLabel}, ${100 - rounded}% ${props.afterLabel}`}
        className="group absolute inset-y-0 z-30 flex w-4 -translate-x-1/2 cursor-ew-resize touch-none justify-center outline-none"
        style={{ left: `${position}%` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
          dragging.current = true;
        }}
        onPointerMove={(event) => {
          if (dragging.current) moveTo(event.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(event) => {
          const next = dividerForKey(position, event.key, event.shiftKey);
          if (next === null) return;
          event.preventDefault();
          setPosition(next);
        }}
      >
        <span className="h-full w-px bg-primary" />
        <span className="absolute top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-background text-foreground shadow-md ring-1 ring-border group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-inset">
          <ChevronsLeftRight className="size-3.5" />
        </span>
      </div>
    </div>
  );
}
