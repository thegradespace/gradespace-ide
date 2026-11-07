import * as Schema from "effect/Schema";

import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const EmailConnectionState = Schema.Literals(["connected", "notConnected", "unknown"]);
export type EmailConnectionState = typeof EmailConnectionState.Type;

/** Read from the provider's local config only; no agent turn runs. */
export const EmailConnectionStatus = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  state: EmailConnectionState,
  /** The email services found, such as `Gmail`. Empty unless connected. */
  connectors: Schema.Array(Schema.String),
});
export type EmailConnectionStatus = typeof EmailConnectionStatus.Type;

export const EmailConnectionsReport = Schema.Struct({
  providers: Schema.Array(EmailConnectionStatus),
});
export type EmailConnectionsReport = typeof EmailConnectionsReport.Type;
