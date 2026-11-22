import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";

import type { ThreadListDeviceLayout } from "../../persistence/mobile-preferences";
import type { ThreadRowDeviceColor } from "../threads/thread-list-v2-items";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_THREAD_LIST_DEVICE_LAYOUT } from "./deviceGrouping";

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

export function useThreadListDeviceLayout() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences, { reportFailure: false });
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
    void savePreferences({ threadListDeviceLayout: next });
  };
  // Transforms read optimistic state so same-frame presses toggle twice.
  const toggleDevice = (environmentId: string) => {
    if (!loaded) return;
    void savePreferences({
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

// The stripe is the bright 500 shade in both themes. Labels are text, so they use a darker shade on
// light backgrounds and a lighter one on dark, which keeps each at least 4.5:1.
export const DEVICE_COLORS: ReadonlyArray<ThreadRowDeviceColor> = [
  { stripe: "#3b82f6", labelClassName: "text-adaptive-blue-600-400" },
  { stripe: "#f59e0b", labelClassName: "text-adaptive-amber-700-300" },
  { stripe: "#f43f5e", labelClassName: "text-adaptive-rose-600-400" },
  { stripe: "#10b981", labelClassName: "text-adaptive-emerald-700-300" },
  { stripe: "#8b5cf6", labelClassName: "text-adaptive-violet-600-400" },
  { stripe: "#0ea5e9", labelClassName: "text-adaptive-sky-700-300" },
];

/** A steady colour per device, in the order the devices were added. */
export function threadListDeviceColor(
  environmentIds: ReadonlyArray<string>,
  environmentId: string,
): ThreadRowDeviceColor | undefined {
  const index = environmentIds.indexOf(environmentId);
  return index < 0 ? undefined : DEVICE_COLORS[index % DEVICE_COLORS.length];
}
