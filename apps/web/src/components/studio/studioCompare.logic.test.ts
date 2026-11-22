import { describe, expect, it } from "vite-plus/test";

import {
  dividerForKey,
  dividerForPointer,
  EMPTY_SCROLL_SYNC,
  syncScrollReport,
} from "./studioCompare.logic";

const report = (scrollY: number, scrollHeight = 4000) => ({
  scrollX: 0,
  scrollY,
  scrollWidth: 1280,
  scrollHeight,
  innerWidth: 1280,
  innerHeight: 800,
});

describe("syncScrollReport", () => {
  it("forwards a user scroll and swallows the echo", () => {
    const first = syncScrollReport(EMPTY_SCROLL_SYNC, 0, report(300));
    expect(first.forward).toEqual({ x: 0, y: 300 });
    const echo = syncScrollReport(first.state, 1, report(300));
    expect(echo.forward).toBeNull();
    expect(echo.state).toEqual(EMPTY_SCROLL_SYNC);
  });

  it("treats a late echo of an older position as an echo, not a new scroll", () => {
    let state = syncScrollReport(EMPTY_SCROLL_SYNC, 0, report(100)).state;
    state = syncScrollReport(state, 0, report(150)).state;
    const late = syncScrollReport(state, 1, report(100));
    expect(late.forward).toBeNull();
    const latest = syncScrollReport(late.state, 1, report(150));
    expect(latest.forward).toBeNull();
    expect(latest.state).toEqual(EMPTY_SCROLL_SYNC);
  });

  it("matches the echo of a shorter page clamped to its end", () => {
    const sent = syncScrollReport(EMPTY_SCROLL_SYNC, 0, report(3000)).state;
    const clamped = syncScrollReport(sent, 1, report(1200, 2000));
    expect(clamped.forward).toBeNull();
  });

  it("follows the other layer once the user scrolls it", () => {
    const sent = syncScrollReport(EMPTY_SCROLL_SYNC, 0, report(300)).state;
    const takeover = syncScrollReport(sent, 1, report(900));
    expect(takeover.forward).toEqual({ x: 0, y: 900 });
    expect(takeover.state).toEqual([[{ x: 0, y: 900 }], []]);
  });
});

describe("divider", () => {
  it("moves by key and stays in range", () => {
    expect(dividerForKey(50, "ArrowLeft", false)).toBe(48);
    expect(dividerForKey(50, "ArrowRight", true)).toBe(60);
    expect(dividerForKey(99, "ArrowUp", false)).toBe(100);
    expect(dividerForKey(5, "PageDown", false)).toBe(0);
    expect(dividerForKey(30, "End", false)).toBe(100);
    expect(dividerForKey(30, "Home", false)).toBe(0);
    expect(dividerForKey(30, "Enter", false)).toBeNull();
  });

  it("follows the pointer across the box", () => {
    expect(dividerForPointer(150, { left: 100, width: 200 })).toBe(25);
    expect(dividerForPointer(0, { left: 100, width: 200 })).toBe(0);
    expect(dividerForPointer(500, { left: 100, width: 200 })).toBe(100);
    expect(dividerForPointer(10, { left: 0, width: 0 })).toBe(50);
  });
});
