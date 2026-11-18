import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";

import type { ThreadListDeviceLayout } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { DEFAULT_THREAD_LIST_DEVICE_LAYOUT } from "./deviceGrouping";

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

export function useThreadListDeviceLayout() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const layout =
    (loaded ? preferencesResult.value.threadListDeviceLayout : undefined) ??
    DEFAULT_THREAD_LIST_DEVICE_LAYOUT;
  const collapsedList = loaded ? preferencesResult.value.threadListCollapsedDevices : undefined;
  const collapsedDevices = useMemo(
    () => (collapsedList ? new Set(collapsedList) : EMPTY_COLLAPSED),
    [collapsedList],
  );

  const setLayout = (next: ThreadListDeviceLayout) => {
    if (!loaded) return;
    savePreferences({ threadListDeviceLayout: next });
  };
  // Transforms read optimistic state so same-frame presses toggle twice.
  const toggleDevice = (environmentId: string) => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => {
        const collapsed = current.threadListCollapsedDevices ?? [];
        return {
          threadListCollapsedDevices: collapsed.includes(environmentId)
            ? collapsed.filter((id) => id !== environmentId)
            : [...collapsed, environmentId],
        };
      },
    });
  };
  return { loaded, layout, collapsedDevices, setLayout, toggleDevice } as const;
}

const DEVICE_COLORS = ["#3b82f6", "#f59e0b", "#ec4899", "#10b981", "#8b5cf6", "#06b6d4"] as const;

/** A steady colour per device, in the order the devices were added. */
export function threadListDeviceColor(
  environmentIds: ReadonlyArray<string>,
  environmentId: string,
): string | undefined {
  const index = environmentIds.indexOf(environmentId);
  return index < 0 ? undefined : DEVICE_COLORS[index % DEVICE_COLORS.length];
}
