import { compileResolvedKeybindingsConfig, DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { shortcutLabelForCommand } from "~/keybindings";

import {
  fitImageZoom,
  fitPageZoom,
  parseStudioKeyZoomMessage,
  parseStudioWheelZoomMessage,
  stepZoom,
  studioZoomForKey,
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

  it("maps the zoom keys to the button steps on each platform", () => {
    const keybindings = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);
    const key = (
      key: string,
      modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean; code?: string },
    ) => ({
      key,
      code: modifiers.code ?? "",
      metaKey: modifiers.meta ?? false,
      ctrlKey: modifiers.ctrl ?? false,
      shiftKey: modifiers.shift ?? false,
      altKey: false,
    });
    expect(studioZoomForKey(key("=", { meta: true }), keybindings, 1, "MacIntel")).toBe(1.1);
    expect(
      studioZoomForKey(
        key("+", { meta: true, shift: true, code: "Equal" }),
        keybindings,
        1,
        "MacIntel",
      ),
    ).toBe(1.1);
    expect(
      studioZoomForKey(key("+", { meta: true, code: "NumpadAdd" }), keybindings, 1, "MacIntel"),
    ).toBe(1.1);
    expect(studioZoomForKey(key("-", { meta: true }), keybindings, 0.8, "MacIntel")).toBe(0.75);
    expect(studioZoomForKey(key("0", { meta: true }), keybindings, 2, "MacIntel")).toBeNull();
    expect(studioZoomForKey(key("=", { ctrl: true }), keybindings, 1, "Win32")).toBe(1.1);
    expect(studioZoomForKey(key("=", { ctrl: true }), keybindings, 1, "MacIntel")).toBeUndefined();
    expect(studioZoomForKey(key("=", {}), keybindings, 1, "MacIntel")).toBeUndefined();
    expect(studioZoomForKey(key("b", { meta: true }), keybindings, 1, "MacIntel")).toBeUndefined();
    expect(
      shortcutLabelForCommand(keybindings, "studio.zoomIn", {
        platform: "MacIntel",
        context: { studioFocus: true },
      }),
    ).toBe("⌘=");
  });

  it("accepts only well-formed key messages", () => {
    const valid = {
      type: "gradespace:studio-key-zoom",
      key: "=",
      code: "Equal",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    };
    expect(parseStudioKeyZoomMessage(valid)).toEqual({
      key: "=",
      code: "Equal",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    });
    expect(parseStudioKeyZoomMessage({ ...valid, type: "other" })).toBeNull();
    expect(parseStudioKeyZoomMessage({ ...valid, key: 1 })).toBeNull();
    expect(parseStudioKeyZoomMessage({ ...valid, metaKey: "yes" })).toBeNull();
    expect(parseStudioKeyZoomMessage(null)).toBeNull();
  });
});
