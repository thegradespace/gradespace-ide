import { createOwnerCredential, type OwnerCredentialStatus } from "@t3tools/client-runtime/relay";
import { parseOwnerToken } from "@t3tools/shared/relayAuth";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { runtime } from "../../lib/runtime";
import { unregisterAgentAwarenessDeviceForCurrentUser } from "../agent-awareness/remoteRegistration";
import type { RelayAccountSource } from "./cloudAccountService";

const OWNER_TOKEN_STORAGE_KEY = "gradespace.connect.owner-token";
// iOS can start the app in the background while the phone is locked; the token must load then.
const OWNER_TOKEN_STORAGE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const credential = createOwnerCredential({
  read: () => SecureStore.getItemAsync(OWNER_TOKEN_STORAGE_KEY, OWNER_TOKEN_STORAGE_OPTIONS),
  write: (token) =>
    SecureStore.setItemAsync(OWNER_TOKEN_STORAGE_KEY, token, OWNER_TOKEN_STORAGE_OPTIONS),
  remove: () => SecureStore.deleteItemAsync(OWNER_TOKEN_STORAGE_KEY, OWNER_TOKEN_STORAGE_OPTIONS),
});

export const ownerAccountSource: RelayAccountSource = {
  addListener: credential.addListener,
  readToken: credential.readToken,
  managedRelay: false,
};

export const loadOwnerCredential = credential.load;

const subscribeOwnerCredential = (onChange: () => void) => credential.addListener(onChange);

export function useOwnerCredentialStatus(): OwnerCredentialStatus {
  return useSyncExternalStore(
    subscribeOwnerCredential,
    credential.getStatus,
    () => "loading" as const,
  );
}

/** False when the text cannot be an owner token, so nothing was saved. */
export async function saveOwnerToken(input: string): Promise<boolean> {
  const token = parseOwnerToken(input);
  if (token === null) return false;
  await credential.save(token);
  return true;
}

/** Tells the relay to forget this device while the token still works, then drops the token. */
export async function removeOwnerToken(): Promise<void> {
  const token = await credential.readToken();
  if (token !== null) {
    await runtime.runPromiseExit(unregisterAgentAwarenessDeviceForCurrentUser(async () => token));
  }
  await credential.remove();
}
