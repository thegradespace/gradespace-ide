import { describe, expect, it } from "@effect/vitest";

import {
  MESSAGE_DEVICE_COLORS,
  type MessageDeviceColor,
  nextMessageDeviceColor,
} from "./messageDevice.ts";

describe("nextMessageDeviceColor", () => {
  it("gives each new device a colour no other device has", () => {
    const used: MessageDeviceColor[] = [];
    for (let index = 0; index < MESSAGE_DEVICE_COLORS.length; index++) {
      used.push(nextMessageDeviceColor(used));
    }
    expect(new Set(used).size).toBe(MESSAGE_DEVICE_COLORS.length);
  });

  it("skips colours in use, wherever they sit in the palette", () => {
    expect(nextMessageDeviceColor(["blue", "amber"])).toBe("emerald");
    expect(nextMessageDeviceColor(["emerald"])).toBe("blue");
  });

  it("repeats the least used colour once every colour is taken", () => {
    const all = [...MESSAGE_DEVICE_COLORS];
    expect(nextMessageDeviceColor(all)).toBe("blue");
    expect(nextMessageDeviceColor([...all, "blue"])).toBe("emerald");
  });
});
