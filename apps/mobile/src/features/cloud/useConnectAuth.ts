import { useAuth } from "@clerk/expo";

import { useOwnerCredentialStatus } from "./ownerCredential";
import { resolveConnectAuthMode, resolveRelayClerkTokenOptions } from "./publicConfig";

export interface ConnectAuth {
  readonly mode: "clerk" | "owner";
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean | undefined;
  /**
   * The token this device links its environments to the relay with. Always null in owner mode,
   * where each machine links itself with `gs connect link --publish-only`.
   */
  readonly getEnvironmentLinkToken: () => Promise<string | null>;
}

function useClerkConnectAuth(): ConnectAuth {
  const { getToken, isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  return {
    mode: "clerk",
    isLoaded,
    isSignedIn,
    getEnvironmentLinkToken: () => getToken(resolveRelayClerkTokenOptions()),
  };
}

function useOwnerConnectAuth(): ConnectAuth {
  const status = useOwnerCredentialStatus();
  return {
    mode: "owner",
    isLoaded: status !== "loading",
    isSignedIn: status === "stored",
    getEnvironmentLinkToken: async () => null,
  };
}

// Owner builds render no ClerkProvider, so Clerk's hook would throw there. The mode is fixed
// for a build, so the same hook runs on every render.
export const useConnectAuth =
  resolveConnectAuthMode() === "owner" ? useOwnerConnectAuth : useClerkConnectAuth;
