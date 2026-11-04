import { describe, expect, it } from "vite-plus/test";

import { injectStudioZoomBridge } from "./studioZoom.ts";

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
});
