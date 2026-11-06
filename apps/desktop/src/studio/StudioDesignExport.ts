import type { DesktopStudioExportRequest } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

export class StudioDesignExportError extends Schema.TaggedError<StudioDesignExportError>()(
  "StudioDesignExportError",
  {
    stage: Schema.Literals(["url", "load", "measure", "render"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.stage) {
      case "url":
        return "Only Studio designs can be exported.";
      case "load":
        return "The design could not be loaded.";
      case "measure":
        return "The design's size could not be measured.";
      case "render":
        return "The design could not be rendered.";
    }
  }
}

// Studio lays pages out at this width, so a page that fills the window exports as Studio shows it.
const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 800;
const MAX_EDGE = 16_384;
const CSS_PIXELS_PER_INCH = 96;
const PARTITION = "studio-design-export";
const STEP_TIMEOUT = Duration.seconds(30);

/** Designs come only from the environment's signed asset route. */
export function isStudioExportUrl(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith("/api/assets/")
  );
}

export interface StudioContentBox {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

const clampEdge = (value: number) => Math.min(MAX_EDGE, Math.max(1, Math.ceil(value)));

/**
 * A page wider or taller than the window keeps its scroll size; otherwise the size is where its
 * content ends, so a fixed 1080×1350 card exports at 1080×1350 rather than at the window's size.
 */
export function studioNaturalSize(box: StudioContentBox): {
  readonly width: number;
  readonly height: number;
} {
  const width =
    box.scrollWidth > box.viewportWidth
      ? box.scrollWidth
      : box.right > 0
        ? box.right
        : box.viewportWidth;
  const height =
    box.scrollHeight > box.viewportHeight
      ? box.scrollHeight
      : box.bottom > 0
        ? box.bottom
        : box.viewportHeight;
  return { width: clampEdge(width), height: clampEdge(height) };
}

// Runs in an isolated world, so the page's own scripts cannot redefine what it reads.
const MEASURE_SCRIPT = `(() => {
  const root = document.documentElement;
  let left = Infinity;
  let right = 0;
  let bottom = 0;
  for (const child of document.body ? document.body.children : []) {
    if (["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"].includes(child.tagName)) continue;
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    left = Math.min(left, rect.left + scrollX);
    right = Math.max(right, rect.right + scrollX);
    bottom = Math.max(bottom, rect.bottom + scrollY);
  }
  return {
    left: left === Infinity ? 0 : left,
    right,
    bottom,
    scrollWidth: root.scrollWidth,
    scrollHeight: root.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  };
})()`;

const SETTLE_SCRIPT = `Promise.race([
  document.fonts ? document.fonts.ready : Promise.resolve(),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(0)))))`;

const ISOLATED_WORLD_ID = 1_001;

const decodeContentBox = Schema.decodeUnknownEffect(
  Schema.Struct({
    left: Schema.Finite,
    right: Schema.Finite,
    bottom: Schema.Finite,
    scrollWidth: Schema.Finite,
    scrollHeight: Schema.Finite,
    viewportWidth: Schema.Finite,
    viewportHeight: Schema.Finite,
  }),
);

let exportSessionReady = false;
function exportSession(): Electron.Session {
  const session = Electron.session.fromPartition(PARTITION, { cache: false });
  if (exportSessionReady) return session;
  exportSessionReady = true;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on("will-download", (event) => event.preventDefault());
  return session;
}

function createExportWindow(url: string): Electron.BrowserWindow {
  const window = new Electron.BrowserWindow({
    show: false,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: {
      offscreen: true,
      session: exportSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      javascript: true,
      webviewTag: false,
      disableDialogs: true,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => {
    if (event.url !== url) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  return window;
}

const step = <A>(stage: StudioDesignExportError["stage"], run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new StudioDesignExportError({ stage, cause }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: STEP_TIMEOUT,
      orElse: () => Effect.fail(new StudioDesignExportError({ stage })),
    }),
  );

const measure = (contents: Electron.WebContents) =>
  step("measure", () =>
    contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: MEASURE_SCRIPT }]),
  ).pipe(
    Effect.flatMap((raw) =>
      decodeContentBox(raw).pipe(
        Effect.mapError((cause) => new StudioDesignExportError({ stage: "measure", cause })),
      ),
    ),
  );

const resize = Effect.fn("desktop.studio.resizeExportWindow")(function* (
  window: Electron.BrowserWindow,
  width: number,
  height: number,
) {
  window.setContentSize(width, height);
  yield* step("render", () =>
    window.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: SETTLE_SCRIPT },
    ]),
  );
});

/** Loads the design in a hidden sandboxed window and renders it at its natural size. */
export const renderStudioDesign = Effect.fn("desktop.studio.renderDesign")(function* (
  request: Pick<DesktopStudioExportRequest, "url" | "format">,
) {
  if (!isStudioExportUrl(request.url)) {
    return yield* new StudioDesignExportError({ stage: "url" });
  }
  const window = yield* Effect.acquireRelease(
    Effect.sync(() => createExportWindow(request.url)),
    (window) =>
      Effect.sync(() => {
        if (!window.isDestroyed()) window.destroy();
      }),
  );
  const contents = window.webContents;
  let status = 0;
  contents.on("did-navigate", (_event, _url, httpResponseCode) => {
    status = httpResponseCode;
  });
  yield* step("load", () => contents.loadURL(request.url));
  if (status >= 400) return yield* new StudioDesignExportError({ stage: "load" });
  yield* step("render", () =>
    contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: SETTLE_SCRIPT }]),
  );

  let box = yield* measure(contents);
  // A card centred in the window: lay it out at its own width once and keep that if it now
  // starts at the left edge.
  if (box.left >= 1 && box.right - box.left >= 1 && box.scrollWidth <= box.viewportWidth) {
    const narrowed = clampEdge(box.right - box.left);
    yield* resize(window, narrowed, PAGE_HEIGHT);
    const retry = yield* measure(contents);
    if (retry.left < 1 && retry.right <= narrowed + 1) box = retry;
    else yield* resize(window, PAGE_WIDTH, PAGE_HEIGHT);
  }
  const size = studioNaturalSize(box);
  yield* resize(window, size.width, size.height);

  if (request.format === "pdf") {
    const pdf = yield* step("render", () =>
      contents.printToPDF({
        printBackground: true,
        preferCSSPageSize: false,
        pageSize: {
          width: size.width / CSS_PIXELS_PER_INCH,
          height: size.height / CSS_PIXELS_PER_INCH,
        },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageRanges: "1",
      }),
    );
    return new Uint8Array(pdf);
  }
  const captured = yield* step("render", () =>
    contents.capturePage(
      { x: 0, y: 0, width: size.width, height: size.height },
      { stayHidden: true },
    ),
  );
  if (captured.isEmpty()) return yield* new StudioDesignExportError({ stage: "render" });
  const captureSize = captured.getSize();
  const image =
    captureSize.width === size.width && captureSize.height === size.height
      ? captured
      : captured.resize({ width: size.width, height: size.height, quality: "best" });
  return new Uint8Array(image.toPNG());
}, Effect.scoped);
