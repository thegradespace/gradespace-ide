import type { getClerkInstance } from "@clerk/expo";
import {
  type CloudAccountSource,
  createCloudAccountService,
  ManagedRelay,
  setManagedRelaySession,
} from "@t3tools/client-runtime/relay";
import {
  reportAtomCommandResult,
  runAtomCommand,
  settleAsyncResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";

import { runtime } from "../../lib/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  getComposerCloudAccountId,
  restoreCloudComposerDrafts,
} from "../../state/use-composer-drafts";
import {
  releaseAgentAwarenessRelayTokenProvider,
  setAgentAwarenessRelayTokenProvider,
  unregisterAgentAwarenessDeviceForCurrentUser,
} from "../agent-awareness/remoteRegistration";
import { removeCloudEnvironments } from "./cloud-drafts";
import { clearConnectOnboardingRequest, requestConnectOnboarding } from "./connectOnboarding";
import { resolveRelayClerkTokenOptions } from "./publicConfig";

type ClerkInstance = ReturnType<typeof getClerkInstance>;

/** Who is signed in to the relay, and the token that proves it. */
export interface RelayAccountSource extends CloudAccountSource {
  readonly readToken: () => Promise<string | null>;
  /** False for an owner token: it registers this device for alerts and lists no environments. */
  readonly managedRelay: boolean;
}

export function clerkAccountSource(clerk: ClerkInstance): RelayAccountSource {
  return {
    addListener: (listener) => clerk.addListener(listener),
    readToken: async () =>
      clerk.session ? await clerk.session.getToken(resolveRelayClerkTokenOptions()) : null,
    managedRelay: true,
  };
}

export function deactivateCloudRelayAccount(): void {
  setAgentAwarenessRelayTokenProvider(null);
  setManagedRelaySession(appAtomRegistry, null);
}

export function activateCloudRelayAccount(
  accountId: string,
  tokenProvider: () => Promise<string | null>,
): void {
  setAgentAwarenessRelayTokenProvider(tokenProvider, accountId);
  setManagedRelaySession(appAtomRegistry, {
    accountId,
    readClerkToken: tokenProvider,
  });
}

const cleanUpCloudAccount = async (
  source: RelayAccountSource,
  accountId: string | null,
  wasActive: boolean,
) => {
  const removal = await runAtomCommand(appAtomRegistry, removeCloudEnvironments, accountId, {
    reportFailure: false,
    reportDefect: false,
  });
  if (removal._tag !== "Success") throw squashAtomCommandFailure(removal);
  const results = await Promise.all([
    settleAsyncResult(() =>
      runtime.runPromiseExit(
        ManagedRelay.ManagedRelayClient.pipe(Effect.flatMap((client) => client.resetTokenCache)),
      ),
    ),
    ...(wasActive
      ? [
          settleAsyncResult(() =>
            runtime.runPromiseExit(unregisterAgentAwarenessDeviceForCurrentUser(source.readToken)),
          ),
        ]
      : []),
  ]);
  for (const result of results) {
    reportAtomCommandResult(result, { label: "cloud account cleanup" });
  }
};

export const cloudAccountService = createCloudAccountService<RelayAccountSource>({
  deactivate: deactivateCloudRelayAccount,
  // Detaching is not a sign-out: the user is usually still signed in, so keep
  // lock-screen activities and the persisted registration for the next attach.
  detach: () => {
    releaseAgentAwarenessRelayTokenProvider();
    setManagedRelaySession(appAtomRegistry, null);
  },
  // A not-yet-presented onboarding request belongs to the account that left.
  onSignOutTransition: clearConnectOnboardingRequest,
  // An owner token has no cloud environments or drafts, and it is gone by the time this runs:
  // removing it unregisters the device first, while the token still works.
  cleanUp: ({ source, accountId, wasActive }) =>
    source.managedRelay ? cleanUpCloudAccount(source, accountId, wasActive) : Promise.resolve(),
  prepare: async ({ source, accountId, isCurrent }) => {
    if (!source.managedRelay) return;
    const storedAccount = await getComposerCloudAccountId();
    if (storedAccount !== null && storedAccount !== accountId) {
      await cleanUpCloudAccount(source, storedAccount, false);
    }
    if (!isCurrent()) return;
    await restoreCloudComposerDrafts(accountId);
  },
  activate: ({ source, accountId, isAccountTransition }) => {
    if (!source.managedRelay) {
      setAgentAwarenessRelayTokenProvider(source.readToken, accountId);
      return;
    }
    activateCloudRelayAccount(accountId, source.readToken);
    // Issued after cleanup so the sheet never lists the previous account's environments.
    if (isAccountTransition) requestConnectOnboarding(accountId);
  },
});
