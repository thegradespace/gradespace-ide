import { render } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "../../index.css";
import type { ScopedSettingsPatch } from "./scopedSettings";

const state = vi.hoisted(() => ({
  updateSettings: vi.fn<(patch: ScopedSettingsPatch) => void>(),
}));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    messageDevices: {
      air: { name: "MacBook Air", kind: "desktop", color: "blue" },
      phone: { name: "iPhone", kind: "mobile", color: "amber" },
    },
  })) as never,
  useUpdateScopedSettings: () => state.updateSettings,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsRow: ({ title, control, children }) => (
    <div>
      <h3>{title}</h3>
      {control}
      {children}
    </div>
  ),
  SettingsSection: (({ children }: { children: ReactNode }) => children) as never,
}));

import { MessageDevicesSettings } from "./MessageDevicesSettings";

describe("message device settings", () => {
  it("keeps a colour to one device and sends renames and colour changes per device", async () => {
    state.updateSettings.mockReset();
    await using _screen = await render(<MessageDevicesSettings />);

    const airColours = page.getByRole("radiogroup", { name: "Colour for MacBook Air" });
    await expect.element(airColours.getByRole("radio", { name: "Amber" })).toBeDisabled();
    await expect.element(airColours.getByRole("radio", { name: "Blue" })).toBeChecked();

    await userEvent.click(airColours.getByRole("radio", { name: "Violet" }));
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      messageDevices: { air: { name: "MacBook Air", kind: "desktop", color: "violet" } },
    });

    const name = page.getByRole("textbox", { name: "Name of iPhone" });
    await userEvent.fill(name, "John's iPhone");
    await userEvent.tab();
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      messageDevices: { phone: { name: "John's iPhone", kind: "mobile", color: "amber" } },
    });
  });
});
