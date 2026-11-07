import { isPrivateNetworkHost } from "@t3tools/shared/hostClassification";
import type { CDPSession } from "playwright-core";

const constVoid = () => {};

/** Routers, NAS boxes and homelab servers use self-signed certificates; public hosts keep Chromium's verdict. */
const certificateErrorAction = (requestURL: string): "continue" | "cancel" => {
  const host = URL.parse(requestURL)?.hostname;
  return host !== undefined && isPrivateNetworkHost(host) ? "continue" : "cancel";
};

/**
 * Agents drive server tabs, so certificate errors are answered here instead of by a prompt.
 * Chromium fails a cancelled request as ERR_ABORTED; `onDeclined` keeps its real error for the report.
 */
export const answerCertificateErrors = async (
  cdp: CDPSession,
  onDeclined: (requestURL: string, errorType: string) => void,
) => {
  cdp.on("Security.certificateError", ({ eventId, requestURL, errorType }) => {
    const action = certificateErrorAction(requestURL);
    if (action === "cancel") onDeclined(requestURL, errorType);
    void cdp.send("Security.handleCertificateError", { eventId, action }).catch(constVoid);
  });
  await cdp.send("Security.enable");
  await cdp.send("Security.setOverrideCertificateErrors", { override: true });
};
