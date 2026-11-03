import {
  DEFAULT_CLIENT_SETTINGS,
  MESSAGE_DEVICE_COLORS,
  type MessageDeviceColor,
  type MessageDeviceStyle,
} from "@t3tools/contracts";

import { thisMessageDevice } from "../../connection/thisDevice";
import { cn } from "~/lib/utils";
import { MessageDeviceGlyph } from "../chat/MessageDevice";
import { messageDeviceColorVar } from "../chat/messageDevice.logic";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const STYLE_LABELS: Record<MessageDeviceStyle, string> = {
  avatar: "Avatar",
  label: "Label",
  edge: "Colour edge",
  tint: "Tinted",
};

const COLOR_LABELS: Record<MessageDeviceColor, string> = {
  blue: "Blue",
  emerald: "Green",
  amber: "Amber",
  pink: "Pink",
  violet: "Violet",
  red: "Red",
};

export function MessageDevicesSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const devices = Object.entries(settings.messageDevices);
  const thisDeviceId = thisMessageDevice()?.id;
  const colorsInUse = new Map(devices.map(([id, device]) => [id, device.color]));

  return (
    <SettingsSection id="appearance-message-devices" title="Message devices">
      <SettingsRow
        {...searchableSetting("message-device-show")}
        description="See which device sent each of your messages."
        resetAction={
          settings.showMessageDevice !== DEFAULT_CLIENT_SETTINGS.showMessageDevice ? (
            <SettingResetButton
              label="sending device"
              onClick={() =>
                updateSettings({ showMessageDevice: DEFAULT_CLIENT_SETTINGS.showMessageDevice })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.showMessageDevice}
            onCheckedChange={(checked) => updateSettings({ showMessageDevice: Boolean(checked) })}
            aria-label="Show sending device"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("message-device-style")}
        description="How the sending device is shown."
        resetAction={
          settings.messageDeviceStyle !== DEFAULT_CLIENT_SETTINGS.messageDeviceStyle ? (
            <SettingResetButton
              label="device style"
              onClick={() =>
                updateSettings({ messageDeviceStyle: DEFAULT_CLIENT_SETTINGS.messageDeviceStyle })
              }
            />
          ) : null
        }
        control={
          <Select
            value={settings.messageDeviceStyle}
            onValueChange={(value) => {
              if (value === "avatar" || value === "label" || value === "edge" || value === "tint")
                updateSettings({ messageDeviceStyle: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Device style">
              <SelectValue>{STYLE_LABELS[settings.messageDeviceStyle]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="avatar">Avatar (default)</SelectItem>
              <SelectItem value="label">Label</SelectItem>
              <SelectItem value="edge">Colour edge</SelectItem>
              <SelectItem value="tint">Tinted</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["messageDevices"]}
        {...searchableSetting("message-devices")}
        description={
          devices.length === 0
            ? "Devices appear here after they connect to this environment."
            : "Every device that has connected to this environment. Names and colours are shared by all your clients."
        }
      >
        <ul className="mt-2 flex flex-col gap-1" aria-label="Devices">
          {devices.map(([id, device]) => (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5">
              <span className="flex min-w-0 flex-1 basis-48 items-center gap-2">
                <MessageDeviceGlyph kind={device.kind} className="size-4" />
                <DraftInput
                  size="sm"
                  aria-label={`Name of ${device.name}`}
                  value={device.name}
                  maxLength={80}
                  onCommit={(name) => {
                    const trimmed = name.trim();
                    if (trimmed !== "" && trimmed !== device.name)
                      updateSettings({ messageDevices: { [id]: { ...device, name: trimmed } } });
                  }}
                />
                {id === thisDeviceId ? (
                  <span className="shrink-0 rounded-full border border-border px-1.5 text-2xs text-muted-foreground">
                    this device
                  </span>
                ) : null}
              </span>
              <div
                role="radiogroup"
                aria-label={`Colour for ${device.name}`}
                className="flex gap-1"
              >
                {MESSAGE_DEVICE_COLORS.map((color) => {
                  const takenByOther =
                    devices.length < MESSAGE_DEVICE_COLORS.length &&
                    [...colorsInUse].some(([otherId, used]) => otherId !== id && used === color);
                  return (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={device.color === color}
                      aria-label={COLOR_LABELS[color]}
                      disabled={takenByOther}
                      onClick={() =>
                        updateSettings({ messageDevices: { [id]: { ...device, color } } })
                      }
                      style={{ backgroundColor: messageDeviceColorVar(color) }}
                      className={cn(
                        "size-4.5 cursor-pointer rounded-full border-2 border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-25",
                        device.color === color && "border-foreground",
                      )}
                    />
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </SettingsRow>
    </SettingsSection>
  );
}
