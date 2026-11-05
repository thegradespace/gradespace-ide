import {
  STUDIO_PICK_POINT_MESSAGE,
  STUDIO_PIN_EXIT_MESSAGE,
  STUDIO_SCROLL_MESSAGE,
} from "@t3tools/shared/studioZoom";

import type { StudioPinNote } from "./studioManifest";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** UI-only pin: the note that reaches the agent plus what is needed to draw and remove it. */
export interface StudioPin extends StudioPinNote {
  readonly id: number;
  readonly variantId: string;
  /** The zoom it was placed at; a page that reflows at another zoom may no longer line up. */
  readonly zoom: number;
}

/** Where the design page is scrolled, as reported by the injected bridge. */
export interface StudioScroll {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

export interface StudioPickPoint extends Point {
  readonly pageX: number;
  readonly pageY: number;
  readonly selector: string;
  readonly text: string;
}

const MAX_SELECTOR = 200;
const MAX_TEXT = 80;

const record = (data: unknown): Record<string, unknown> | null =>
  typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// Page text ends up in the user's draft, so keep it to one short line.
const shortLine = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : null;

export function parseStudioScrollMessage(data: unknown): StudioScroll | null {
  const message = record(data);
  if (message?.type !== STUDIO_SCROLL_MESSAGE) return null;
  const { scrollX, scrollY, scrollWidth, scrollHeight, innerWidth, innerHeight } = message;
  if (
    !finite(scrollX) ||
    !finite(scrollY) ||
    !finite(scrollWidth) ||
    !finite(scrollHeight) ||
    !finite(innerWidth) ||
    !finite(innerHeight) ||
    innerWidth <= 0 ||
    innerHeight <= 0
  ) {
    return null;
  }
  return {
    scrollX: Math.max(0, scrollX),
    scrollY: Math.max(0, scrollY),
    scrollWidth: Math.max(scrollWidth, innerWidth),
    scrollHeight: Math.max(scrollHeight, innerHeight),
    innerWidth,
    innerHeight,
  };
}

export function parseStudioPickPointMessage(data: unknown): StudioPickPoint | null {
  const message = record(data);
  if (message?.type !== STUDIO_PICK_POINT_MESSAGE) return null;
  const { x, y, pageX, pageY } = message;
  const selector = shortLine(message.selector, MAX_SELECTOR);
  const text = shortLine(message.text, MAX_TEXT);
  if (!finite(x) || !finite(y) || !finite(pageX) || !finite(pageY)) return null;
  if (selector === null || text === null) return null;
  return { x, y, pageX, pageY, selector, text };
}

export function isStudioPinExitMessage(data: unknown): boolean {
  return record(data)?.type === STUDIO_PIN_EXIT_MESSAGE;
}

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** A click inside the overlay as fractions of the visible area. */
export function overlayPointFractions(point: Point, box: Size): Point {
  return {
    x: box.width > 0 ? unit(point.x / box.width) : 0,
    y: box.height > 0 ? unit(point.y / box.height) : 0,
  };
}

/** A click the bridge reported, in the page's viewport pixels, as fractions of the visible area. */
export function pickPointFractions(
  pick: Point,
  scroll: Pick<StudioScroll, "innerWidth" | "innerHeight">,
): Point {
  return { x: unit(pick.x / scroll.innerWidth), y: unit(pick.y / scroll.innerHeight) };
}

/**
 * Where to draw a pin over the frame. Anchored pins follow the page's scroll and vanish when
 * scrolled out of view; pins without a scroll report stay at their place in the visible area.
 */
export function pinOverlayPoint(
  pin: Pick<StudioPinNote, "fx" | "fy" | "page">,
  view: { readonly zoom: number; readonly box: Size; readonly scroll: StudioScroll | null },
): Point | null {
  if (pin.page === null || view.scroll === null) {
    return { x: pin.fx * view.box.width, y: pin.fy * view.box.height };
  }
  const x = (pin.page.x - view.scroll.scrollX) * view.zoom;
  const y = (pin.page.y - view.scroll.scrollY) * view.zoom;
  return x < 0 || y < 0 || x > view.box.width || y > view.box.height ? null : { x, y };
}

/** Overlay position of a fresh click, shown before the pin exists. */
export function fractionsOverlayPoint(fractions: Point, box: Size): Point {
  return { x: fractions.x * box.width, y: fractions.y * box.height };
}

/** Keeps a popover of `size` inside `box`, below and to the right of `point` when it fits. */
export function popoverOrigin(point: Point, size: Size, box: Size): Point {
  const gap = 10;
  const fit = (value: number, extent: number, limit: number) =>
    Math.max(0, Math.min(value, limit - extent));
  return {
    x: fit(point.x + gap, size.width, box.width),
    y: fit(point.y + gap, size.height, box.height),
  };
}

export type NewStudioPin = Omit<StudioPin, "id" | "number">;

/** A click waiting for its comment. */
export interface StudioPinDraft extends Pick<StudioPinNote, "fx" | "fy" | "page"> {
  /** Which compare pane it was placed in. */
  readonly pane: 0 | 1;
}
