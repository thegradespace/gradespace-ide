import {
  resolveLocalReference,
  runStudioChecks,
  type StudioCheckIssue,
  studioLocalReferences,
} from "./studioChecks";

// Nothing in the copy may reach the network: links are checked against the project's files.
const NO_NETWORK =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

export interface StudioCheckFiles {
  /** Contents of a project-relative text file, or null when it can't be read. */
  readonly readText: (path: string) => Promise<string | null>;
  readonly exists: (path: string) => Promise<boolean>;
}

const isStylesheet = (element: Element) =>
  (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet");

/**
 * The page as a self-contained document: local stylesheets inlined, everything else blocked,
 * so a copy can be styled for the checks without loading anything.
 */
async function selfContainedHtml(
  doc: Document,
  baseDir: string,
  files: StudioCheckFiles,
): Promise<string> {
  for (const link of Array.from(doc.querySelectorAll("link[href]")).filter(isStylesheet)) {
    const path = resolveLocalReference(baseDir, link.getAttribute("href") ?? "");
    const css = path === null ? null : await files.readText(path);
    if (css === null) continue;
    const style = doc.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
  }
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", NO_NETWORK);
  doc.head.prepend(meta);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/** Loads `html` in a hidden same-origin frame with scripts off and hands its document over. */
async function withCheckDocument<A>(
  owner: Document,
  html: string,
  use: (doc: Document) => A,
): Promise<A> {
  // oxlint-disable-next-line react/iframe-missing-sandbox -- sandboxed on the next line, scripts off
  const frame = owner.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1280px;height:800px;border:0;pointer-events:none;";
  try {
    const loaded = new Promise<void>((resolve) =>
      frame.addEventListener("load", () => resolve(), { once: true }),
    );
    frame.srcdoc = html;
    owner.body.append(frame);
    await loaded;
    const doc = frame.contentDocument;
    if (doc === null) throw new Error("The design could not be loaded for checks.");
    return use(doc);
  } finally {
    frame.remove();
  }
}

export async function checkStudioHtml(
  html: string,
  baseDir: string,
  files: StudioCheckFiles,
): Promise<StudioCheckIssue[]> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const references = studioLocalReferences(parsed, baseDir);
  const existing = new Set<string>();
  await Promise.all(
    references.map(async (path) => {
      if (await files.exists(path)) existing.add(path);
    }),
  );
  const source = await selfContainedHtml(parsed, baseDir, files);
  return withCheckDocument(document, source, (doc) =>
    runStudioChecks(doc, { baseDir, fileExists: (path) => existing.has(path) }),
  );
}
