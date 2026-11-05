export const STUDIO_ZOOM_QUERY_PARAM = "studio-zoom";
export const STUDIO_WHEEL_ZOOM_MESSAGE = "gradespace:studio-wheel-zoom";
export const STUDIO_SCROLL_MESSAGE = "gradespace:studio-scroll";
export const STUDIO_PICK_POINT_MESSAGE = "gradespace:studio-pick-point";
export const STUDIO_PIN_MODE_MESSAGE = "gradespace:studio-pin-mode";
export const STUDIO_PIN_EXIT_MESSAGE = "gradespace:studio-pin-exit";
export const STUDIO_SCROLL_TO_MESSAGE = "gradespace:studio-scroll-to";
export const STUDIO_MAX_HTML_BYTES = 5 * 1024 * 1024;

/**
 * Sandboxed designs live in a cross-origin frame, so pinch and Ctrl/Cmd+wheel never reach Studio;
 * the script forwards them in the bubble phase so pages that handle them win. It reports scroll,
 * the element under a pin-mode click, and scrolls where Studio asks after a reload. Nothing else
 * leaves the frame.
 */
export function injectStudioZoomBridge(html: string): string {
  const script = `<script>
(() => {
  const post = (message) => parent.postMessage(message, "*");
  addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented) return;
    event.preventDefault();
    post({
      type: ${JSON.stringify(STUDIO_WHEEL_ZOOM_MESSAGE)},
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      x: event.clientX,
      y: event.clientY,
    });
  }, { passive: false });

  let scheduled = false;
  const reportScroll = () => {
    scheduled = false;
    const root = document.documentElement;
    post({
      type: ${JSON.stringify(STUDIO_SCROLL_MESSAGE)},
      scrollX: scrollX,
      scrollY: scrollY,
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      innerWidth: innerWidth,
      innerHeight: innerHeight,
    });
  };
  const scheduleScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reportScroll);
  };
  addEventListener("scroll", scheduleScroll, { passive: true });
  addEventListener("resize", scheduleScroll);
  addEventListener("load", scheduleScroll);
  document.addEventListener("DOMContentLoaded", scheduleScroll);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(scheduleScroll).observe(document.documentElement);
  }

  const escape = (value) => {
    const text = String(value).slice(0, 40);
    return window.CSS && CSS.escape ? CSS.escape(text) : text.replace(/[^\\w-]/g, "");
  };
  const selectorOf = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      const tag = node.localName;
      if (tag === "html") break;
      let part = tag;
      if (node.id) {
        parts.unshift(part + "#" + escape(node.id));
        break;
      }
      const name = node.classList && node.classList[0];
      if (name) part += "." + escape(name);
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter((child) => child.localName === tag)
        : [];
      if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      parts.unshift(part);
    }
    return parts.join(" > ").slice(0, 200);
  };
  const textOf = (element) =>
    String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);

  let pinMode = false;
  let pinStyle = null;
  const setPinMode = (on) => {
    pinMode = on;
    if (on && !pinStyle) {
      pinStyle = document.createElement("style");
      pinStyle.textContent = "*, *::before, *::after { cursor: crosshair !important; }";
      document.documentElement.appendChild(pinStyle);
    } else if (!on && pinStyle) {
      pinStyle.remove();
      pinStyle = null;
    }
  };
  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== parent || !data) return;
    if (data.type === ${JSON.stringify(STUDIO_SCROLL_TO_MESSAGE)}) {
      if (Number.isFinite(data.x) && Number.isFinite(data.y)) scrollTo(data.x, data.y);
      return;
    }
    if (data.type === ${JSON.stringify(STUDIO_PIN_MODE_MESSAGE)} && typeof data.on === "boolean") {
      setPinMode(data.on);
    }
  });
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "auxclick"]) {
    addEventListener(name, (event) => {
      if (!pinMode) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  addEventListener("click", (event) => {
    if (!pinMode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY) || event.target;
    post({
      type: ${JSON.stringify(STUDIO_PICK_POINT_MESSAGE)},
      x: event.clientX,
      y: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
      selector: target && target.nodeType === 1 ? selectorOf(target) : "",
      text: target && target.nodeType === 1 ? textOf(target) : "",
    });
  }, true);
  addEventListener("keydown", (event) => {
    if (!pinMode || event.key !== "Escape") return;
    event.preventDefault();
    post({ type: ${JSON.stringify(STUDIO_PIN_EXIT_MESSAGE)} });
  }, true);
})();
</script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const end = head.index + head[0].length;
    return `${html.slice(0, end)}${script}${html.slice(end)}`;
  }
  // A doctype must stay first, or the page falls into quirks mode.
  const doctype = /^﻿?\s*<!doctype[^>]*>/i.exec(html);
  const end = doctype ? doctype[0].length : 0;
  return `${html.slice(0, end)}${script}${html.slice(end)}`;
}
