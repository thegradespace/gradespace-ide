import { MessageId, type MessageDevice } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ChatMessage } from "../../types";
import { replyDevicesByRowId, shortDeviceName } from "./messageDevice.logic";

const air: MessageDevice = { id: "air", name: "MacBook Air", kind: "desktop" };
const phone: MessageDevice = { id: "phone", name: "iPhone", kind: "mobile" };

const row = (id: string, role: ChatMessage["role"], extra: Partial<ChatMessage> = {}) => ({
  id,
  message: {
    id: MessageId.make(id),
    role,
    text: "",
    runId: null,
    streaming: false,
    createdAt: "",
    updatedAt: "",
    ...extra,
  } satisfies ChatMessage,
});

describe("replyDevicesByRowId", () => {
  it("credits every reply to the latest message you sent, and none before the first", () => {
    const replies = replyDevicesByRowId([
      row("early", "assistant"),
      row("q1", "user", { device: air }),
      row("a1", "assistant"),
      row("a2", "assistant"),
      row("q2", "user", { device: phone }),
      row("a3", "assistant"),
      row("q3", "user"),
      row("a4", "assistant"),
    ]);
    expect([...replies]).toEqual([
      ["a1", air],
      ["a2", air],
      ["a3", phone],
    ]);
  });

  it("keeps the exchange going through a message another agent sent", () => {
    const replies = replyDevicesByRowId([
      row("q1", "user", { device: air }),
      row("relay", "user", { createdBy: "agent" }),
      row("a1", "assistant"),
    ]);
    expect(replies.get("a1")).toEqual(air);
  });
});

describe("shortDeviceName", () => {
  it.each([
    ["MacBook Pro", "Pro"],
    ["iPhone", "iPhone"],
    ["John's MacBook Air", "Air"],
    ["Chrome on macOS", "Chrome"],
  ])("shortens %s to %s", (name, short) => {
    expect(shortDeviceName(name)).toBe(short);
  });
});
