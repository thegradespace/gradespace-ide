import { useState } from "react";
import {
  computeStableMessagesTimelineRows,
  handoffRunsSignature,
  type MessagesTimelineRowsInput,
  sameRowsInput,
  deriveMessagesTimelineRowsWithState,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { type HandoffTimelineRun } from "./V2LifecycleRow";
import type { TimelineEntry } from "../../session-logic";
import { collectStudioTurnSets, type StudioTurnSet } from "../studio/studioTurnSets.logic";

const EMPTY_TIMELINE_RUNS: ReadonlyArray<HandoffTimelineRun> = [];

export function useStableHandoffRuns(
  runs: ReadonlyArray<HandoffTimelineRun>,
): ReadonlyArray<HandoffTimelineRun> {
  const [state, setState] = useState<{
    readonly source: ReadonlyArray<HandoffTimelineRun> | null;
    readonly signature: string;
    readonly value: ReadonlyArray<HandoffTimelineRun>;
  }>({ source: null, signature: "", value: EMPTY_TIMELINE_RUNS });
  if (state.source === runs) return state.value;
  const signature = handoffRunsSignature(runs);
  const value =
    signature === state.signature
      ? state.value
      : runs.map((run) => ({
          id: run.id,
          ordinal: run.ordinal,
          providerInstanceId: run.providerInstanceId,
          modelSelection: run.modelSelection,
        }));
  setState({ source: runs, signature, value });
  return value;
}

/**
 * Rows derived from the previous projection of the same list, so a streamed
 * text update patches its message rows instead of deriving every row again.
 */
export function useIncrementalTimelineRows(
  identity: string,
  input: MessagesTimelineRowsInput,
): MessagesTimelineRow[] {
  const [state, setState] = useState(() => ({
    identity,
    input,
    projection: deriveMessagesTimelineRowsWithState(input),
  }));
  if (state.identity === identity && sameRowsInput(state.input, input)) {
    return state.projection.rows;
  }
  const projection = deriveMessagesTimelineRowsWithState(
    input,
    state.identity === identity ? state.projection : null,
  );
  setState({ identity, input, projection });
  return projection.rows;
}

export function useStableRows(
  rows: MessagesTimelineRow[],
  identity: string,
): MessagesTimelineRow[] {
  const [state, setState] = useState<{
    readonly identity: string;
    readonly source: MessagesTimelineRow[] | null;
    readonly stable: StableMessagesTimelineRowsState;
  }>({ identity, source: null, stable: { byId: new Map(), result: [] } });
  if (state.identity === identity && state.source === rows) return state.stable.result;
  const stable = computeStableMessagesTimelineRows(
    rows,
    state.identity === identity ? state.stable : { byId: new Map(), result: [] },
  );
  setState({ identity, source: rows, stable });
  return stable.result;
}

const NO_STUDIO_TURN_SETS: ReadonlyMap<string, ReadonlyArray<StudioTurnSet>> = new Map();

/** Studio sets per reply; keeps one map while they are unchanged so rows do not re-render. */
export function useStableStudioTurnSets(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  cwd: string | undefined,
): ReadonlyMap<string, ReadonlyArray<StudioTurnSet>> {
  const [state, setState] = useState<{
    readonly source: ReadonlyArray<TimelineEntry> | null;
    readonly cwd: string | undefined;
    readonly signature: string;
    readonly value: ReadonlyMap<string, ReadonlyArray<StudioTurnSet>>;
  }>({ source: null, cwd: undefined, signature: "", value: NO_STUDIO_TURN_SETS });
  if (state.source === timelineEntries && state.cwd === cwd) return state.value;
  const rows = timelineEntries.flatMap((entry) => {
    const projected =
      entry.kind === "work"
        ? entry.entry.projectedItem
        : entry.kind === "message"
          ? entry.projectedItem
          : undefined;
    return projected === undefined ? [] : [projected];
  });
  const next = collectStudioTurnSets(rows, cwd ?? null);
  const signature = JSON.stringify([...next]);
  const value = signature === state.signature ? state.value : next;
  setState({ source: timelineEntries, cwd, signature, value });
  return value;
}
