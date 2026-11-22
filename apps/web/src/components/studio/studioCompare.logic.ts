import type { Point, StudioScroll } from "./studioPins";

export type CompareLayer = 0 | 1;

/** Scroll positions sent to each layer that have not been reported back yet. */
export type ScrollSyncState = readonly [readonly Point[], readonly Point[]];

export const EMPTY_SCROLL_SYNC: ScrollSyncState = [[], []];

const MAX_PENDING = 20;

/**
 * Keeps two pages scrolled together. A report that matches a position this layer was sent (or
 * that position clamped to a shorter page) is its echo and goes nowhere; anything else is the
 * user scrolling, which the other layer follows.
 */
export function syncScrollReport(
  state: ScrollSyncState,
  from: CompareLayer,
  report: StudioScroll,
): { readonly state: ScrollSyncState; readonly forward: Point | null } {
  const maxX = Math.max(0, report.scrollWidth - report.innerWidth);
  const maxY = Math.max(0, report.scrollHeight - report.innerHeight);
  const pending = state[from];
  const echo = pending.findIndex(
    (sent) =>
      Math.abs(Math.min(sent.x, maxX) - report.scrollX) <= 1 &&
      Math.abs(Math.min(sent.y, maxY) - report.scrollY) <= 1,
  );
  const other: CompareLayer = from === 0 ? 1 : 0;
  if (echo !== -1) {
    const rest = pending.slice(echo + 1);
    return { state: from === 0 ? [rest, state[1]] : [state[0], rest], forward: null };
  }
  const forward = { x: report.scrollX, y: report.scrollY };
  const sent = [...state[other], forward].slice(-MAX_PENDING);
  return { state: from === 0 ? [[], sent] : [sent, []], forward };
}

/** The divider position, as a percentage, a key moves it to; null for keys it ignores. */
export function dividerForKey(current: number, key: string, shiftKey: boolean): number | null {
  const step = shiftKey ? 10 : 2;
  const next =
    key === "ArrowLeft" || key === "ArrowDown"
      ? current - step
      : key === "ArrowRight" || key === "ArrowUp"
        ? current + step
        : key === "PageDown"
          ? current - 10
          : key === "PageUp"
            ? current + 10
            : key === "Home"
              ? 0
              : key === "End"
                ? 100
                : null;
  return next === null ? null : Math.min(100, Math.max(0, next));
}

/** A pointer's x as a percentage across a box. */
export function dividerForPointer(clientX: number, box: { left: number; width: number }): number {
  if (box.width <= 0) return 50;
  return Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100));
}
