import type { MessageDevice } from "@t3tools/contracts";
import { hashTelemetryId } from "@t3tools/shared/telemetryId";

import { currentClientMetadata, readAnalyticsDeviceId } from "./platform";

let thisDevice: MessageDevice | null | undefined;

/** This client as the server records it on messages it sends; null where storage is blocked. */
export function thisMessageDevice(): MessageDevice | null {
  if (thisDevice !== undefined) return thisDevice;
  try {
    const metadata = currentClientMetadata();
    thisDevice =
      metadata.deviceName === undefined || metadata.surface === undefined
        ? null
        : metadata.surface === "desktop" || metadata.surface === "web"
          ? {
              id: hashTelemetryId(readAnalyticsDeviceId()),
              name: metadata.deviceName,
              kind: metadata.surface,
            }
          : null;
  } catch {
    thisDevice = null;
  }
  return thisDevice;
}
