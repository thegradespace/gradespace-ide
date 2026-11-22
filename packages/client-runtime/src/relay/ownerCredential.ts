import type { CloudAccountSource } from "./cloudAccountService.ts";

/** Names the owner account on this device only; the relay keys its data by its own owner ID. */
export const OWNER_ACCOUNT_ID = "owner";

export interface OwnerCredentialStorage {
  readonly read: () => Promise<string | null>;
  readonly write: (token: string) => Promise<void>;
  readonly remove: () => Promise<void>;
}

export type OwnerCredentialStatus = "loading" | "missing" | "stored";

/**
 * The owner token of a relay that runs without Clerk, as an account source: a stored token is
 * a signed-in owner. The status is "loading" until storage has been read.
 */
export interface OwnerCredential extends CloudAccountSource {
  readonly load: () => Promise<void>;
  readonly readToken: () => Promise<string | null>;
  readonly save: (token: string) => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly getStatus: () => OwnerCredentialStatus;
}

export function createOwnerCredential(storage: OwnerCredentialStorage): OwnerCredential {
  let token: string | null | undefined;
  let loading: Promise<void> | null = null;
  const listeners = new Set<Parameters<CloudAccountSource["addListener"]>[0]>();

  const resources = () => ({
    user: token === undefined ? undefined : token === null ? null : { id: OWNER_ACCOUNT_ID },
  });
  const set = (next: string | null) => {
    token = next;
    for (const listener of listeners) listener(resources());
  };

  return {
    addListener(listener) {
      listeners.add(listener);
      listener(resources());
      return () => {
        listeners.delete(listener);
      };
    },
    load() {
      // A failed read is not a missing token: reporting one would drop this device's registration.
      loading ??= storage.read().then(
        (stored) => {
          if (token === undefined) set(stored);
        },
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
      return loading;
    },
    readToken: async () => token ?? null,
    save: async (next) => {
      await storage.write(next);
      set(next);
    },
    remove: async () => {
      await storage.remove();
      set(null);
    },
    getStatus: () => (token === undefined ? "loading" : token === null ? "missing" : "stored"),
  };
}
