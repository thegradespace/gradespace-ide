export const STUDIO_ZOOM_QUERY_PARAM = "studio-zoom";
const STUDIO_WHEEL_ZOOM_MESSAGE = "gradespace:studio-wheel-zoom";
export const STUDIO_MAX_HTML_BYTES = 5 * 1024 * 1024;

/**
 * Sandboxed designs live in a cross-origin frame, so pinch and Ctrl/Cmd+wheel never reach Studio.
 * The script listens in the bubble phase so pages that handle those gestures themselves win.
 */
export function injectStudioZoomBridge(html: string): string {
  const script = `<script>
(() => {
  addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented) return;
    event.preventDefault();
    parent.postMessage({
      type: ${JSON.stringify(STUDIO_WHEEL_ZOOM_MESSAGE)},
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      x: event.clientX,
      y: event.clientY,
    }, "*");
  }, { passive: false });
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
