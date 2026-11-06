import { assert, describe, it } from "@effect/vitest";

import { isStudioExportUrl, studioNaturalSize } from "./StudioDesignExport.ts";

describe("StudioDesignExport", () => {
  it("loads only asset route URLs", () => {
    assert.isTrue(isStudioExportUrl("http://127.0.0.1:3773/api/assets/token/a.html"));
    assert.isTrue(isStudioExportUrl("https://box.tail.ts.net/api/assets/token/a.html"));
    assert.isFalse(isStudioExportUrl("file:///etc/passwd"));
    assert.isFalse(isStudioExportUrl("https://example.com/a.html"));
    assert.isFalse(isStudioExportUrl("https://user:pw@example.com/api/assets/t/a.html"));
    assert.isFalse(isStudioExportUrl("javascript:alert(1)"));
    assert.isFalse(isStudioExportUrl("not a url"));
  });

  it("sizes a page by where its content ends unless it overflows the window", () => {
    const window = { viewportWidth: 1280, viewportHeight: 800 };
    assert.deepStrictEqual(
      studioNaturalSize({
        ...window,
        left: 0,
        right: 1080,
        bottom: 1350,
        scrollWidth: 1280,
        scrollHeight: 1350,
      }),
      { width: 1080, height: 1350 },
    );
    assert.deepStrictEqual(
      studioNaturalSize({
        ...window,
        left: 0,
        right: 1200,
        bottom: 627.5,
        scrollWidth: 1280,
        scrollHeight: 800,
      }),
      { width: 1200, height: 628 },
    );
    assert.deepStrictEqual(
      studioNaturalSize({
        ...window,
        left: 0,
        right: 1280,
        bottom: 0,
        scrollWidth: 1920,
        scrollHeight: 800,
      }),
      { width: 1920, height: 800 },
    );
    assert.deepStrictEqual(
      studioNaturalSize({
        ...window,
        left: 0,
        right: 1280,
        bottom: 90_000,
        scrollWidth: 1280,
        scrollHeight: 90_000,
      }),
      { width: 1280, height: 16_384 },
    );
  });
});
