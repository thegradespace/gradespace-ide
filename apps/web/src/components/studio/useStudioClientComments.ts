import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, StudioShareComment } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useServerConfigs } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

/** Studio asks the website at most this often, and only while it is open and focused. */
const STUDIO_CLIENT_COMMENTS_INTERVAL_MS = 60_000;
const CHECK_EVERY_MS = 15_000;
const DISMISSED_KEY = "gs-studio-dismissed-client-pins";
/** Old ids fall off the end; a dismissed comment on a long-gone link no longer matters. */
const MAX_DISMISSED = 500;
const Dismissed = Schema.Array(Schema.String);
const NONE: readonly StudioShareComment[] = [];

export interface StudioClientComments {
  readonly comments: readonly StudioShareComment[];
  /** Live links from this set that take comments. */
  readonly watching: number;
  readonly refreshing: boolean;
  readonly refresh: () => void;
  readonly dismissed: ReadonlySet<string>;
  /** Hides comments here only; they stay on the website. */
  readonly dismiss: (ids: readonly string[]) => void;
}

const studioInFocus = () =>
  typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();

/** Comments clients left through share links of this set, polled gently. */
export function useStudioClientComments(
  environmentId: EnvironmentId,
  setPath: string,
): StudioClientComments {
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.studioShareComments === true;
  const allowed = useAtomValue(
    serverEnvironment.fetchStudioShareComments.permissionAtom(environmentId),
  );
  const fetchComments = useAtomCommand(serverEnvironment.fetchStudioShareComments, {
    reportFailure: false,
  });
  const [result, setResult] = useState<{
    readonly key: string;
    readonly comments: readonly StudioShareComment[];
    readonly watching: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastFetch = useRef(0);
  const [dismissedIds, setDismissedIds] = useLocalStorage<readonly string[], readonly string[]>(
    DISMISSED_KEY,
    [],
    Dismissed,
  );
  const enabled = supported && allowed;
  const key = `${environmentId}:${setPath}`;

  const load = useStableCallback(
    async (target: { environmentId: EnvironmentId; setPath: string }) => {
      if (!enabled) return;
      lastFetch.current = Date.now();
      setRefreshing(true);
      const answer = await fetchComments({
        environmentId: target.environmentId,
        input: { setPath: target.setPath },
      }).finally(() => setRefreshing(false));
      // A failed poll keeps what was shown; the next one tries again.
      if (answer._tag === "Success") {
        setResult({
          key: `${target.environmentId}:${target.setPath}`,
          comments: answer.value.comments,
          watching: answer.value.watching,
        });
      }
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the website through the server while Studio is open and focused
  useEffect(() => {
    if (!enabled) return;
    const target = { environmentId, setPath };
    void load(target);
    const due = () => {
      if (studioInFocus() && Date.now() - lastFetch.current >= STUDIO_CLIENT_COMMENTS_INTERVAL_MS) {
        void load(target);
      }
    };
    const timer = window.setInterval(due, CHECK_EVERY_MS);
    window.addEventListener("focus", due);
    document.addEventListener("visibilitychange", due);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", due);
      document.removeEventListener("visibilitychange", due);
    };
  }, [enabled, environmentId, setPath, load]);

  const current = enabled && result?.key === key ? result : null;
  const dismissed = new Set(dismissedIds);
  return {
    comments: current?.comments ?? NONE,
    watching: current?.watching ?? 0,
    refreshing,
    refresh: () => void load({ environmentId, setPath }),
    dismissed,
    dismiss: (ids) =>
      setDismissedIds((previous) => [...new Set([...previous, ...ids])].slice(-MAX_DISMISSED)),
  };
}
