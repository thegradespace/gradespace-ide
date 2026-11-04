import { describe, expect, it } from "vite-plus/test";

import {
  fitImageZoom,
  fitPageZoom,
  parseStudioWheelZoomMessage,
  stepZoom,
  wheelZoom,
  zoomPercent,
} from "./studioZoom";

describe("studio zoom", () => {
  it("steps through the list from any zoom, including a fitted one", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.8, 1)).toBe(0.9);
    expect(stepZoom(0.8, -1)).toBe(0.75);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.25, -1)).toBe(0.25);
    expect(stepZoom(0.2, 1)).toBe(0.25);
  });

  it("fits the page at 1280px and clamps extreme containers", () => {
    expect(fitPageZoom(640)).toBe(0.5);
    expect(fitPageZoom(100)).toBe(0.1);
    expect(fitPageZoom(10_000)).toBe(3);
    expect(fitImageZoom({ width: 400, height: 300 }, { width: 800, height: 400 })).toBe(0.5);
    expect(zoomPercent(0.675)).toBe("68%");
  });

  it("maps wheel deltas continuously, capped per event and clamped overall", () => {
    expect(wheelZoom(1, 0, 0)).toBe(1);
    expect(wheelZoom(1, -5, 0)).toBeGreaterThan(1);
    expect(wheelZoom(1, 5, 0)).toBeLessThan(1);
    expect(wheelZoom(1, -1000, 0)).toBeCloseTo(Math.exp(0.3));
    expect(wheelZoom(1, 3, 1)).toBeCloseTo(wheelZoom(1, 48, 0));
    expect(wheelZoom(2.9, -30, 0)).toBe(3);
    expect(wheelZoom(0.26, 30, 0)).toBe(0.25);
  });

  it("accepts only well-formed wheel messages", () => {
    const valid = { type: "gradespace:studio-wheel-zoom", deltaY: -3, deltaMode: 0, x: 1, y: 2 };
    expect(parseStudioWheelZoomMessage(valid)).toEqual({ deltaY: -3, deltaMode: 0 });
    expect(parseStudioWheelZoomMessage({ ...valid, type: "other" })).toBeNull();
    expect(parseStudioWheelZoomMessage({ ...valid, deltaY: "3" })).toBeNull();
    expect(parseStudioWheelZoomMessage({ ...valid, deltaY: Number.NaN })).toBeNull();
    expect(parseStudioWheelZoomMessage({ ...valid, deltaMode: 7 })).toBeNull();
    expect(parseStudioWheelZoomMessage(null)).toBeNull();
  });
});
