import type { EnvironmentId, MessageDevice, MessageDeviceKind } from "@t3tools/contracts";
import { GlobeIcon, LaptopIcon, SmartphoneIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { useClientSettings, useEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "~/lib/utils";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { messageDeviceColorVar } from "./messageDevice.logic";

/** Name and colour are the environment's current choice; the stamped values cover forgotten devices. */
export function useMessageDevicePresentation(
  environmentId: EnvironmentId,
  device: MessageDevice | undefined,
) {
  const show = useClientSettings((settings) => settings.showMessageDevice);
  const style = useClientSettings((settings) => settings.messageDeviceStyle);
  const entry = useEnvironmentSettings(environmentId, (settings) =>
    device === undefined ? undefined : settings.messageDevices[device.id],
  );
  if (!show || device === undefined) return null;
  return {
    style,
    name: entry?.name ?? device.name,
    kind: entry?.kind ?? device.kind,
    cssVars: { "--message-device": messageDeviceColorVar(entry?.color) } as CSSProperties,
  };
}
export type MessageDevicePresentation = NonNullable<
  ReturnType<typeof useMessageDevicePresentation>
>;

export function MessageDeviceGlyph({
  kind,
  className,
}: {
  readonly kind: MessageDeviceKind;
  readonly className?: string | undefined;
}) {
  const Icon = kind === "mobile" ? SmartphoneIcon : kind === "web" ? GlobeIcon : LaptopIcon;
  return <Icon aria-hidden="true" className={cn("size-3 shrink-0", className)} />;
}

/** Text in the device colour, pulled toward the foreground so any theme keeps AA contrast. */
const MESSAGE_DEVICE_INK_CLASS_NAME = "message-device-ink";

/** Icons keep more of the colour than text; they only need 3:1. */
const MESSAGE_DEVICE_ICON_INK_CLASS_NAME = "message-device-icon";

/** Round icon beside the bubble; the parent reserves its width. */
export function MessageDeviceAvatar({ device }: { readonly device: MessageDevicePresentation }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`Sent from ${device.name}`}
            data-message-device-style="avatar"
            className={cn(
              "message-device-avatar absolute start-full bottom-0 ms-2 grid size-7 place-items-center rounded-full border",
            )}
          />
        }
      >
        <MessageDeviceGlyph
          kind={device.kind}
          className={cn("size-3.5", MESSAGE_DEVICE_ICON_INK_CLASS_NAME)}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{device.name}</TooltipPopup>
    </Tooltip>
  );
}

/** Icon, name and, for the label styles, the time. */
export function MessageDeviceLine({
  device,
  createdAt,
  timestampFormat,
  tone,
  className,
}: {
  readonly device: MessagePresentationLine;
  readonly createdAt?: string;
  readonly timestampFormat?: TimestampFormat;
  readonly tone: "muted" | "device";
  readonly className?: string;
}) {
  return (
    <p
      data-message-device-style={device.style}
      className={cn(
        "flex min-w-0 items-center gap-1 text-2xs",
        tone === "muted" ? "text-muted-foreground" : "font-medium",
        className,
      )}
    >
      <MessageDeviceGlyph
        kind={device.kind}
        className={tone === "device" ? MESSAGE_DEVICE_ICON_INK_CLASS_NAME : undefined}
      />
      <span className={cn("truncate", tone === "device" && MESSAGE_DEVICE_INK_CLASS_NAME)}>
        {device.name}
      </span>
      {createdAt !== undefined && timestampFormat !== undefined ? (
        <span className={cn("shrink-0 tabular-nums", tone === "device" && "text-muted-foreground")}>
          · {formatDayAwareTimestamp(createdAt, timestampFormat)}
        </span>
      ) : null}
    </p>
  );
}

type MessagePresentationLine = Pick<MessageDevicePresentation, "kind" | "name" | "style">;
