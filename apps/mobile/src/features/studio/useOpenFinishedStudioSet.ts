import { useNavigation } from "@react-navigation/native";
import {
  latestStudioSetWrittenByRun,
  STUDIO_ROOT,
  type StudioObservedRun,
  studioRunFinishedWhileWatched,
} from "@t3tools/client-runtime/studio";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { useSelectedThreadVisibleTurnItems } from "../../state/use-thread-detail";

/** Opens Studio on the set a run wrote when this screen watched that run finish. */
export function useOpenFinishedStudioSet(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly latestRun: { readonly runId: string; readonly status: string } | null;
  readonly cwd: string | null;
}) {
  const navigation = useNavigation();
  const turnItems = useSelectedThreadVisibleTurnItems();
  const current: StudioObservedRun = {
    identity:
      input.threadRef === null
        ? null
        : scopedThreadKey(input.threadRef.environmentId, input.threadRef.threadId),
    runId: input.latestRun?.runId ?? null,
    status: input.latestRun?.status ?? null,
  };
  const [observed, setObserved] = useState(current);
  // A fresh object per finish, so the same run finishing again still opens Studio.
  const [finished, setFinished] = useState<{ readonly runId: string } | null>(null);
  if (
    observed.identity !== current.identity ||
    observed.runId !== current.runId ||
    observed.status !== current.status
  ) {
    setObserved(current);
    const runId = studioRunFinishedWhileWatched(observed, current);
    if (runId !== null) setFinished({ runId });
  }

  const openFinishedSet = useEffectEvent((runId: string) => {
    const ref = input.threadRef;
    if (ref === null || !navigation.isFocused()) return;
    const setPath = latestStudioSetWrittenByRun(turnItems, runId, input.cwd);
    if (setPath === null) return;
    navigation.navigate("ThreadStudioSet", {
      environmentId: String(ref.environmentId),
      threadId: String(ref.threadId),
      set: setPath.slice(STUDIO_ROOT.length + 1),
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the Studio route once when a watched run that wrote a set finishes
  useEffect(() => {
    if (finished !== null) openFinishedSet(finished.runId);
  }, [finished]);
}
