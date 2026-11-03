import type { MessageDevice, MessageDeviceColor } from "@t3tools/contracts";

import type { ChatMessage } from "../../types";

/** The CSS variable holding a device colour, tuned per theme in index.css. */
export const messageDeviceColorVar = (color: MessageDeviceColor | undefined): string =>
  `var(${color === undefined ? "--muted-foreground" : `--device-${color}`})`;

/** "MacBook Air" -> "Air", "Chrome on macOS" -> "Chrome", for the line above a reply. */
export function shortDeviceName(name: string): string {
  const browser = /^(.+?) on \S/u.exec(name);
  if (browser?.[1]) return browser[1];
  return name.trim().split(/\s+/u).at(-1) ?? name;
}

/**
 * For each assistant message row, the device of the user message it answers.
 * Messages from other agents or the server do not start a new exchange.
 */
export function replyDevicesByRowId(
  rows: ReadonlyArray<{ readonly id: string; readonly message?: ChatMessage }>,
): ReadonlyMap<string, MessageDevice> {
  const replies = new Map<string, MessageDevice>();
  let asking: MessageDevice | undefined;
  for (const row of rows) {
    const message = row.message;
    if (message === undefined) continue;
    if (message.role === "user") {
      if (message.createdBy === undefined || message.createdBy === "user") asking = message.device;
    } else if (message.role === "assistant" && asking !== undefined) {
      replies.set(row.id, asking);
    }
  }
  return replies;
}
