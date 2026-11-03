import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MessageDeviceKind = Schema.Literals(["desktop", "mobile", "web"]);
export type MessageDeviceKind = typeof MessageDeviceKind.Type;

/**
 * The client device that sent a user message, stamped by the server from the
 * connection that dispatched it. Messages from agents, MCP and the server have none.
 */
export const MessageDevice = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  kind: MessageDeviceKind,
});
export type MessageDevice = typeof MessageDevice.Type;

/** Names only; clients choose theme-safe shades for each. */
export const MESSAGE_DEVICE_COLORS = ["blue", "emerald", "amber", "pink", "violet", "red"] as const;
export const MessageDeviceColor = Schema.Literals(MESSAGE_DEVICE_COLORS);
export type MessageDeviceColor = typeof MessageDeviceColor.Type;

/** A device the environment has seen, with the name and colour shown for it. */
export const MessageDeviceSetting = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  kind: MessageDeviceKind,
  color: MessageDeviceColor,
});
export type MessageDeviceSetting = typeof MessageDeviceSetting.Type;

/** The first colour no device uses; once all are taken, the least used one. */
export function nextMessageDeviceColor(used: Iterable<MessageDeviceColor>): MessageDeviceColor {
  const counts = new Map<MessageDeviceColor, number>();
  for (const color of used) counts.set(color, (counts.get(color) ?? 0) + 1);
  let best: MessageDeviceColor = MESSAGE_DEVICE_COLORS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of MESSAGE_DEVICE_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

export const MessageDeviceStyle = Schema.Literals(["avatar", "label", "edge", "tint"]);
export type MessageDeviceStyle = typeof MessageDeviceStyle.Type;
