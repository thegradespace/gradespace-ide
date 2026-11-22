import { describe, expect, it } from "vite-plus/test";

import {
  isStudioPinExitMessage,
  overlayPointFractions,
  parseStudioPickPointMessage,
  parseStudioScrollMessage,
  pickPointFractions,
  pinOverlayPoint,
  popoverOrigin,
  studioClientPins,
  studioSharedFileVersion,
  videoPictureFractions,
} from "./studioPins";

const scrollMessage = {
  type: "gradespace:studio-scroll",
  scrollX: 0,
  scrollY: 200,
  scrollWidth: 1280,
  scrollHeight: 3000,
  innerWidth: 1280,
  innerHeight: 700,
};
const pickMessage = {
  type: "gradespace:studio-pick-point",
  x: 320,
  y: 70,
  pageX: 320,
  pageY: 270,
  selector: "main > a.cta",
  text: "Get started",
};

describe("bridge messages", () => {
  it("reads a scroll report and rejects other shapes", () => {
    expect(parseStudioScrollMessage(scrollMessage)).toEqual({
      scrollX: 0,
      scrollY: 200,
      scrollWidth: 1280,
      scrollHeight: 3000,
      innerWidth: 1280,
      innerHeight: 700,
    });
    expect(parseStudioScrollMessage({ ...scrollMessage, innerWidth: 0 })).toBeNull();
    expect(parseStudioScrollMessage({ ...scrollMessage, scrollY: "9" })).toBeNull();
    expect(parseStudioScrollMessage({ ...scrollMessage, scrollY: Infinity })).toBeNull();
    expect(parseStudioScrollMessage({ ...scrollMessage, type: "other" })).toBeNull();
    expect(parseStudioScrollMessage(null)).toBeNull();
    expect(parseStudioScrollMessage("gradespace:studio-scroll")).toBeNull();
  });

  it("never reports a page smaller than its viewport", () => {
    expect(
      parseStudioScrollMessage({ ...scrollMessage, scrollWidth: 10, scrollHeight: 10 }),
    ).toMatchObject({ scrollWidth: 1280, scrollHeight: 700 });
  });

  it("reads a picked point and keeps page text to one short line", () => {
    expect(parseStudioPickPointMessage(pickMessage)).toEqual({
      x: 320,
      y: 70,
      pageX: 320,
      pageY: 270,
      selector: "main > a.cta",
      text: "Get started",
    });
    const noisy = parseStudioPickPointMessage({
      ...pickMessage,
      selector: "a".repeat(500),
      text: `  Line one\n\n${"word ".repeat(40)}`,
    });
    expect(noisy?.selector).toHaveLength(200);
    expect(noisy?.text).toHaveLength(80);
    expect(noisy?.text.startsWith("Line one word")).toBe(true);
    expect(parseStudioPickPointMessage({ ...pickMessage, x: NaN })).toBeNull();
    expect(parseStudioPickPointMessage({ ...pickMessage, text: 5 })).toBeNull();
    expect(
      parseStudioPickPointMessage({ ...pickMessage, type: "gradespace:studio-scroll" }),
    ).toBeNull();
  });

  it("recognises only the exit message", () => {
    expect(isStudioPinExitMessage({ type: "gradespace:studio-pin-exit" })).toBe(true);
    expect(isStudioPinExitMessage({ type: "gradespace:studio-pin-mode", on: false })).toBe(false);
    expect(isStudioPinExitMessage(undefined)).toBe(false);
  });
});

describe("pin coordinates", () => {
  const box = { width: 640, height: 400 };
  const scroll = parseStudioScrollMessage(scrollMessage)!;

  it("turns clicks into fractions of the visible area, clamped", () => {
    expect(overlayPointFractions({ x: 160, y: 100 }, box)).toEqual({ x: 0.25, y: 0.25 });
    expect(overlayPointFractions({ x: -5, y: 900 }, box)).toEqual({ x: 0, y: 1 });
    expect(overlayPointFractions({ x: 5, y: 5 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
    expect(pickPointFractions({ x: 320, y: 70 }, scroll)).toEqual({ x: 0.25, y: 0.1 });
  });

  it("follows the page as it scrolls and hides pins that leave the view", () => {
    const pin = {
      fx: 0.25,
      fy: 0.1,
      page: { x: 320, y: 270, width: 1280, height: 3000, selector: "", text: "" },
    };
    const at = (scrollY: number) =>
      pinOverlayPoint(pin, { zoom: 0.5, box, scroll: { ...scroll, scrollY } });
    expect(at(200)).toEqual({ x: 160, y: 35 });
    expect(at(0)).toEqual({ x: 160, y: 135 });
    expect(at(400)).toBeNull();
    expect(
      pinOverlayPoint(
        { ...pin, page: { ...pin.page, y: 1000 } },
        { zoom: 0.5, box, scroll: { ...scroll, scrollY: 0 } },
      ),
    ).toBeNull();
  });

  it("scales anchored pins with the zoom", () => {
    const pin = {
      fx: 0,
      fy: 0,
      page: { x: 400, y: 300, width: 1280, height: 3000, selector: "", text: "" },
    };
    expect(pinOverlayPoint(pin, { zoom: 1, box, scroll: { ...scroll, scrollY: 0 } })).toEqual({
      x: 400,
      y: 300,
    });
    expect(pinOverlayPoint(pin, { zoom: 1.5, box, scroll: { ...scroll, scrollY: 0 } })).toBeNull();
  });

  it("places a client's pin at the same share of the page, whatever width they viewed it at", () => {
    // Left on a phone: 390 wide, 6000 tall. Shown on a 1280 by 3000 page.
    const pin = {
      fx: 0,
      fy: 0,
      page: { x: 195, y: 1200, width: 390, height: 6000, selector: "", text: "" },
      clientCommentId: "c1",
    };
    expect(pinOverlayPoint(pin, { zoom: 0.5, box, scroll: { ...scroll, scrollY: 400 } })).toEqual({
      x: 320,
      y: 100,
    });
  });

  it("keeps unanchored pins where they were placed, whatever the page does", () => {
    const pin = { fx: 0.5, fy: 0.25, page: null };
    expect(pinOverlayPoint(pin, { zoom: 2, box, scroll: null })).toEqual({ x: 320, y: 100 });
    expect(pinOverlayPoint(pin, { zoom: 2, box, scroll })).toEqual({ x: 320, y: 100 });
  });

  it("measures video clicks against the letterboxed picture", () => {
    const element = { x: 100, y: 50, width: 800, height: 600 };
    // A 16:9 picture fills the width and leaves 75px bars above and below.
    const picture = { width: 1920, height: 1080 };
    expect(videoPictureFractions({ x: 500, y: 350 }, element, picture)).toEqual({ x: 0.5, y: 0.5 });
    expect(videoPictureFractions({ x: 100, y: 125 }, element, picture)).toEqual({ x: 0, y: 0 });
    expect(videoPictureFractions({ x: 300, y: 60 }, element, picture)).toEqual({ x: 0.25, y: 0 });
    expect(videoPictureFractions({ x: 500, y: 350 }, element, { width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("keeps the comment popover inside the frame", () => {
    const popover = { width: 224, height: 120 };
    expect(popoverOrigin({ x: 20, y: 20 }, popover, box)).toEqual({ x: 30, y: 30 });
    expect(popoverOrigin({ x: 630, y: 390 }, popover, box)).toEqual({ x: 416, y: 280 });
    expect(popoverOrigin({ x: 5, y: 5 }, popover, { width: 100, height: 50 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("client comments as pins", () => {
  const setPath = ".gradespace/studio/2026-11-22-test";
  const variants = [
    { id: "A", title: "Bold", file: "a.html" },
    { id: "B", title: "Calm", file: "b.html", revisions: [{ file: "b.v1.html" }] },
  ];
  const comment = (id: string, file: string, name = "Ada") => ({
    id,
    shareId: `share-${file}`,
    relativePath: `${setPath}/${file}`,
    name,
    comment: `About ${file}`,
    fx: 0.5,
    fy: 0.5,
    page: null,
    createdAt: "2026-11-22T10:00:00.000Z",
  });

  it("finds the option and version a shared file is", () => {
    expect(studioSharedFileVersion(variants, setPath, `${setPath}/a.html`)).toEqual({
      variantId: "A",
      version: null,
    });
    expect(studioSharedFileVersion(variants, `${setPath}/`, `${setPath}/b.v1.html`)).toEqual({
      variantId: "B",
      version: 1,
    });
    expect(studioSharedFileVersion(variants, setPath, `${setPath}/gone.html`)).toBeNull();
    expect(studioSharedFileVersion(variants, setPath, `${setPath}-2/a.html`)).toBeNull();
  });

  it("numbers pins per version, keeps ids apart from local pins and leaves out dismissed ones", () => {
    const pins = studioClientPins(
      [
        comment("c1", "a.html"),
        comment("c2", "b.v1.html", "Ben"),
        comment("c3", "a.html"),
        comment("c4", "gone.html"),
        comment("c5", "a.html"),
      ],
      variants,
      setPath,
      new Set(["c3"]),
    );
    expect(
      pins.map((pin) => [
        pin.id,
        pin.clientCommentId,
        pin.variantId,
        pin.version,
        pin.number,
        pin.author,
      ]),
    ).toEqual([
      [-1, "c1", "A", null, 1, "Ada"],
      [-2, "c2", "B", 1, 1, "Ben"],
      [-5, "c5", "A", null, 2, "Ada"],
    ]);
  });
});
