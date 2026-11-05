import { describe, expect, it } from "vite-plus/test";

import {
  injectStudioZoomBridge,
  STUDIO_PICK_POINT_MESSAGE,
  STUDIO_PIN_EXIT_MESSAGE,
  STUDIO_PIN_MODE_MESSAGE,
  STUDIO_SCROLL_MESSAGE,
  STUDIO_WHEEL_ZOOM_MESSAGE,
} from "./studioZoom.ts";

describe("injectStudioZoomBridge", () => {
  it("places the script where the document still parses the same way", () => {
    const script = (html: string) => injectStudioZoomBridge(html);
    expect(script("<!DOCTYPE html><HEAD lang=x><title>a</title>")).toMatch(
      /^<!DOCTYPE html><HEAD lang=x><script>[\s\S]*<\/script><title>a<\/title>$/,
    );
    expect(script("<!doctype html><body>hi</body>")).toMatch(
      /^<!doctype html><script>[\s\S]*<\/script><body>hi<\/body>$/,
    );
    expect(script("<p>hi</p>")).toMatch(/^<script>[\s\S]*<\/script><p>hi<\/p>$/);
    expect(script("<header>x</header>")).toMatch(/^<script>/);
  });

  it("ships a script that parses and carries every bridge message", () => {
    const injected = injectStudioZoomBridge("<head></head>");
    const source = /<script>([\s\S]*)<\/script>/.exec(injected)?.[1] ?? "";
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain(String.raw`.replace(/\s+/g, " ")`);
    expect(source).toContain(String.raw`.replace(/[^\w-]/g, "")`);
    for (const type of [
      STUDIO_WHEEL_ZOOM_MESSAGE,
      STUDIO_SCROLL_MESSAGE,
      STUDIO_PICK_POINT_MESSAGE,
      STUDIO_PIN_MODE_MESSAGE,
      STUDIO_PIN_EXIT_MESSAGE,
    ]) {
      expect(source).toContain(JSON.stringify(type));
    }
  });
});
