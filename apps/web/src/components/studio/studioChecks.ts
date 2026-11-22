export type StudioCheckKind = "contrast" | "accessibility" | "links";

export interface StudioCheckIssue {
  readonly kind: StudioCheckKind;
  readonly message: string;
  /** Finds the element in the design, built the way the pin bridge builds its selectors. */
  readonly selector: string | null;
}

export interface StudioCheckOptions {
  /** Project-relative folder of the page, which its relative links resolve against. */
  readonly baseDir: string;
  /** Whether a project-relative path exists; links are not checked without it. */
  readonly fileExists?: ((path: string) => boolean) | undefined;
}

const MAX_TEXT = 40;

const shortText = (value: string | null | undefined) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
};

const cssEscape = (value: string) => {
  const text = value.slice(0, 40);
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(text) : text.replace(/[^\w-]/g, "");
};

/** Matches `selectorOf` in the injected Studio bridge, so the bridge can find the element again. */
function studioSelectorOf(element: Element): string {
  const parts: string[] = [];
  for (
    let node: Element | null = element;
    node !== null && parts.length < 4;
    node = node.parentElement
  ) {
    const tag = node.localName;
    if (tag === "html") break;
    let part = tag;
    if (node.id) {
      parts.unshift(`${part}#${cssEscape(node.id)}`);
      break;
    }
    const name = node.classList[0];
    if (name) part += `.${cssEscape(name)}`;
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter((child) => child.localName === tag)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    parts.unshift(part);
  }
  return parts.join(" > ").slice(0, 200);
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

const channel = (value: string, max: number) =>
  value.endsWith("%") ? (Number.parseFloat(value) / 100) * max : Number.parseFloat(value);

/** Reads the colour forms browsers compute: rgb(), rgba() and hex. Anything else is unknown. */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  const named = NAMED[text];
  if (named !== undefined) return named;
  const hex = /^#([\da-f]{3,8})$/.exec(text)?.[1];
  if (hex !== undefined) {
    const full =
      hex.length === 3 || hex.length === 4
        ? [...hex].map((digit) => digit + digit).join("")
        : hex.length === 6 || hex.length === 8
          ? hex
          : null;
    if (full === null) return null;
    const byte = (index: number) => Number.parseInt(full.slice(index, index + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(text)?.[1];
  if (fn === undefined) return null;
  const parts = fn
    .replace("/", " ")
    .split(/[\s,]+/)
    .filter((part) => part.length > 0);
  if (parts.length < 3 || parts.length > 4) return null;
  const [r, g, b] = parts.slice(0, 3).map((part) => channel(part, 255));
  const a = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if ([r, g, b, a].some((part) => part === undefined || !Number.isFinite(part))) return null;
  return { r: r!, g: g!, b: b!, a: Math.min(1, Math.max(0, a)) };
}

const over = (top: Rgba, bottom: Rgba): Rgba => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

const luminance = ({ r, g, b }: Rgba) => {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

const WHITE = NAMED.white!;

function isHidden(element: Element, view: Window): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return true;
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return true;
    }
  }
  return false;
}

/** The solid colour behind an element, or null behind an image or gradient, which can't be judged. */
function backgroundBehind(element: Element, view: Window): Rgba | null {
  const layers: Rgba[] = [];
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.backgroundImage && style.backgroundImage !== "none") return null;
    const color = parseCssColor(style.backgroundColor || "transparent");
    if (color === null) return null;
    if (color.a > 0) layers.push(color);
    if (color.a >= 1) break;
  }
  return layers.reduceRight((below, layer) => over(layer, below), WHITE);
}

const ownText = (element: Element) =>
  Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .trim();

const SKIPPED_TEXT = new Set(["script", "style", "noscript", "template", "title", "option"]);

function contrastIssues(doc: Document, view: Window): StudioCheckIssue[] {
  const issues: StudioCheckIssue[] = [];
  for (const element of Array.from(doc.body?.querySelectorAll("*") ?? [])) {
    if (SKIPPED_TEXT.has(element.localName) || element.closest("svg") !== null) continue;
    const text = ownText(element);
    if (text.length === 0 || isHidden(element, view)) continue;
    const style = view.getComputedStyle(element);
    const color = parseCssColor(style.color);
    const background = backgroundBehind(element, view);
    if (color === null || background === null) continue;
    const ratio = contrastRatio(over(color, background), background);
    const size = Number.parseFloat(style.fontSize) || 16;
    const weight = style.fontWeight === "bold" ? 700 : Number.parseInt(style.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const needed = large ? 3 : 4.5;
    if (ratio >= needed) continue;
    issues.push({
      kind: "contrast",
      message: `Low contrast: "${shortText(text)}" is ${(Math.floor(ratio * 10) / 10).toFixed(1)}:1, needs ${needed}:1`,
      selector: studioSelectorOf(element),
    });
  }
  return issues;
}

function labelledByText(element: Element): string {
  const ids = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  return ids
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

function accessibleName(element: Element): string {
  const named =
    labelledByText(element) ||
    element.getAttribute("aria-label")?.trim() ||
    (element.textContent ?? "").trim() ||
    Array.from(element.querySelectorAll("img[alt], [aria-label]"))
      .map((child) => child.getAttribute("alt") ?? child.getAttribute("aria-label") ?? "")
      .join(" ")
      .trim() ||
    Array.from(element.querySelectorAll("svg title"))
      .map((title) => title.textContent ?? "")
      .join(" ")
      .trim() ||
    element.getAttribute("title")?.trim();
  return named ?? "";
}

function inputButtonName(element: HTMLInputElement): string {
  const type = element.type.toLowerCase();
  if (type === "submit" || type === "reset") return "default";
  if (type === "image") return element.getAttribute("alt")?.trim() || accessibleName(element);
  return element.value.trim() || accessibleName(element);
}

const FIELD_SKIP = new Set(["hidden", "submit", "button", "reset", "image"]);

function fieldHasLabel(field: Element): boolean {
  if (labelledByText(field) || field.getAttribute("aria-label")?.trim()) return true;
  if (field.getAttribute("title")?.trim()) return true;
  if ((field.closest("label")?.textContent ?? "").trim()) return true;
  const id = field.getAttribute("id");
  if (!id) return false;
  return Array.from(field.ownerDocument.querySelectorAll("label")).some(
    (label) => label.getAttribute("for") === id && (label.textContent ?? "").trim().length > 0,
  );
}

function accessibilityIssues(doc: Document, view: Window): StudioCheckIssue[] {
  const issues: StudioCheckIssue[] = [];
  const add = (message: string, element: Element | null) =>
    issues.push({
      kind: "accessibility",
      message,
      selector: element === null ? null : studioSelectorOf(element),
    });
  if (!doc.documentElement.getAttribute("lang")?.trim()) {
    add("The page has no lang attribute", null);
  }
  const visible = (selector: string) =>
    Array.from(doc.body?.querySelectorAll(selector) ?? []).filter(
      (element) => !isHidden(element, view),
    );
  for (const image of visible("img")) {
    const role = image.getAttribute("role");
    if (image.hasAttribute("alt") || role === "presentation" || role === "none") continue;
    if (image.getAttribute("aria-label")?.trim() || labelledByText(image)) continue;
    const file = (image.getAttribute("src") ?? "").split(/[?#]/)[0]?.split("/").at(-1) ?? "";
    add(file ? `Image has no alt text: ${shortText(file)}` : "Image has no alt text", image);
  }
  for (const button of visible('button, [role="button"], input[type="button" i]')) {
    const name =
      button.localName === "input"
        ? inputButtonName(button as HTMLInputElement)
        : accessibleName(button);
    if (!name) add("Button has no accessible name", button);
  }
  for (const input of visible(
    'input[type="submit" i], input[type="reset" i], input[type="image" i]',
  )) {
    if (!inputButtonName(input as HTMLInputElement)) add("Button has no accessible name", input);
  }
  for (const link of visible("a[href]")) {
    if (!accessibleName(link)) add("Link has no accessible name", link);
  }
  for (const field of visible("input, select, textarea")) {
    const type = (field.getAttribute("type") ?? "text").toLowerCase();
    if (field.localName === "input" && FIELD_SKIP.has(type)) continue;
    if (!fieldHasLabel(field)) add("Form field has no label", field);
  }
  let previous = 0;
  for (const heading of visible("h1, h2, h3, h4, h5, h6")) {
    const level = Number(heading.localName.slice(1));
    if (previous > 0 && level > previous + 1) {
      add(
        `Heading skips a level, h${previous} to h${level}: "${shortText(heading.textContent)}"`,
        heading,
      );
    }
    previous = level;
  }
  return issues;
}

const REFERENCE_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
  ["a[href]", "href"],
  ["img[src]", "src"],
  ["link[href]", "href"],
  ["script[src]", "src"],
  ["source[src]", "src"],
  ["video[src]", "src"],
  ["video[poster]", "poster"],
  ["audio[src]", "src"],
];

/**
 * A project-relative path for a link that points at a local file, or null for anything else:
 * other sites, other schemes, in-page anchors, root paths, or a path that leaves the project.
 */
export function resolveLocalReference(baseDir: string, reference: string): string | null {
  const raw = reference.trim();
  if (raw.length === 0 || raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("\\")) {
    return null;
  }
  if (/^[a-z][\w+.-]*:/i.test(raw)) return null;
  const pathPart = raw.split(/[?#]/)[0] ?? "";
  if (pathPart.length === 0) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }
  const segments = baseDir.split("/").filter((segment) => segment.length > 0);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length === 0 ? null : segments.join("/");
}

function localReferences(doc: Document, baseDir: string) {
  return REFERENCE_ATTRIBUTES.flatMap(([selector, attribute]) =>
    Array.from(doc.querySelectorAll(selector)).flatMap((element) => {
      const value = element.getAttribute(attribute) ?? "";
      const path = resolveLocalReference(baseDir, value);
      return path === null ? [] : [{ element, value: value.trim(), path }];
    }),
  );
}

/** Project-relative files the page links to, for looking up before the checks run. */
export function studioLocalReferences(doc: Document, baseDir: string): string[] {
  return [...new Set(localReferences(doc, baseDir).map((reference) => reference.path))];
}

function linkIssues(doc: Document, options: StudioCheckOptions): StudioCheckIssue[] {
  const issues: StudioCheckIssue[] = [];
  for (const link of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = (link.getAttribute("href") ?? "").trim();
    if (href === "" || href === "#") {
      issues.push({
        kind: "links",
        message: `Link goes nowhere (href="${href}"): "${shortText(link.textContent) || "no text"}"`,
        selector: studioSelectorOf(link),
      });
    }
  }
  const fileExists = options.fileExists;
  if (fileExists === undefined) return issues;
  for (const reference of localReferences(doc, options.baseDir)) {
    if (fileExists(reference.path)) continue;
    issues.push({
      kind: "links",
      message: `Missing file: ${shortText(reference.value)}`,
      selector: studioSelectorOf(reference.element),
    });
  }
  return issues;
}

/**
 * Checks one rendered design for low contrast, basic accessibility gaps and broken links. Needs
 * a document with styles applied, so contrast reads computed colours.
 */
export function runStudioChecks(doc: Document, options: StudioCheckOptions): StudioCheckIssue[] {
  const view = doc.defaultView;
  return [
    ...(view === null ? [] : contrastIssues(doc, view)),
    ...(view === null ? [] : accessibilityIssues(doc, view)),
    ...linkIssues(doc, options),
  ];
}
