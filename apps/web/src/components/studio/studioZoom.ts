import { STUDIO_WHEEL_ZOOM_MESSAGE } from "@t3tools/shared/studioZoom";

// Pages lay out at a desktop width and shrink to fit, so a thumbnail shows the whole design.
export const STUDIO_PAGE_WIDTH = 1280;

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
// Fit may go below the smallest step so a narrow panel still shows the whole width.
const MIN_FIT_ZOOM = 0.1;
// A mouse wheel notch reports ~100 where a trackpad pinch reports single digits; cap the notch.
const MAX_WHEEL_DELTA = 30;
const WHEEL_ZOOM_RATE = 0.01;

const clamp = (zoom: number, min: number) => Math.min(MAX_ZOOM, Math.max(min, zoom));

export function fitPageZoom(containerWidth: number): number {
  return clamp(containerWidth / STUDIO_PAGE_WIDTH, MIN_FIT_ZOOM);
}

export function fitImageZoom(
  container: { readonly width: number; readonly height: number },
  image: { readonly width: number; readonly height: number },
): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return clamp(
    Math.min(container.width / image.width, container.height / image.height),
    MIN_FIT_ZOOM,
  );
}

export function stepZoom(current: number, direction: 1 | -1): number {
  const epsilon = 0.001;
  const next =
    direction === 1
      ? ZOOM_STEPS.find((step) => step > current + epsilon)
      : ZOOM_STEPS.findLast((step) => step < current - epsilon);
  return next ?? (direction === 1 ? MAX_ZOOM : MIN_ZOOM);
}

export function wheelZoom(current: number, deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  const capped = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, pixels));
  return clamp(current * Math.exp(-capped * WHEEL_ZOOM_RATE), MIN_ZOOM);
}

export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function parseStudioWheelZoomMessage(
  data: unknown,
): { readonly deltaY: number; readonly deltaMode: number } | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.type !== STUDIO_WHEEL_ZOOM_MESSAGE) return null;
  const { deltaY, deltaMode } = message;
  if (typeof deltaY !== "number" || !Number.isFinite(deltaY)) return null;
  if (deltaMode !== 0 && deltaMode !== 1 && deltaMode !== 2) return null;
  return { deltaY, deltaMode };
}
