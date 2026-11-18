import type { EnvironmentId } from "@t3tools/contracts";

import type { ThreadListDeviceLayout } from "../../persistence/mobile-preferences";
import { threadListV2ListItemsAreEqual, type ThreadListV2ListItem } from "../threads/threadListV2";

export const DEFAULT_THREAD_LIST_DEVICE_LAYOUT: ThreadListDeviceLayout = "sections";

export interface DeviceHeaderListItem {
  readonly type: "v2-device-header";
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly count: number;
  readonly collapsed: boolean;
}

export interface ProjectHeaderListItem {
  readonly type: "v2-project-header";
  readonly key: string;
  readonly projectKey: string;
  readonly count: number;
}

export type HomeThreadListItem =
  | ThreadListV2ListItem
  | DeviceHeaderListItem
  | ProjectHeaderListItem;

type RowItem = Extract<ThreadListV2ListItem, { readonly type: "v2-thread" | "v2-pending" }>;

const isRow = (item: HomeThreadListItem): item is RowItem =>
  item.type === "v2-thread" || item.type === "v2-pending";

const rowEnvironmentId = (row: RowItem) =>
  row.type === "v2-thread" ? row.item.thread.environmentId : row.pendingTask.environmentId;

/** The thread list's devices, most recently active first. */
export function threadListDeviceOrder(items: ReadonlyArray<ThreadListV2ListItem>) {
  const order: EnvironmentId[] = [];
  for (const item of items) {
    if (!isRow(item)) continue;
    const environmentId = rowEnvironmentId(item);
    if (!order.includes(environmentId)) order.push(environmentId);
  }
  return order;
}

/**
 * Splits each shelf's rows into a section per device, most recently active device first, and in
 * the device-then-project layout into project groups inside each device. Rows keep their order
 * within a group. The filter and colour layouts, and a list from one device, are unchanged.
 */
export function groupThreadListByDevice(
  items: ReadonlyArray<ThreadListV2ListItem>,
  input: {
    readonly layout: ThreadListDeviceLayout;
    readonly collapsedDevices: ReadonlySet<string>;
    readonly projectKeyOf: (row: RowItem) => string;
  },
): ReadonlyArray<HomeThreadListItem> {
  if (input.layout !== "sections" && input.layout !== "device-project") return items;
  const devices = threadListDeviceOrder(items);
  if (devices.length < 2) return items;

  const result: HomeThreadListItem[] = [];
  let segment: RowItem[] = [];
  let segmentIndex = 0;
  const flush = () => {
    if (segment.length === 0) return;
    for (const environmentId of devices) {
      const rows = segment.filter((row) => rowEnvironmentId(row) === environmentId);
      if (rows.length === 0) continue;
      const collapsed = input.collapsedDevices.has(environmentId);
      result.push({
        type: "v2-device-header",
        key: `v2-device:${segmentIndex}:${environmentId}`,
        environmentId,
        count: rows.length,
        collapsed,
      });
      if (collapsed) continue;
      if (input.layout === "sections") {
        result.push(...withGroupDividers(rows));
        continue;
      }
      const projects: string[] = [];
      for (const row of rows) {
        const projectKey = input.projectKeyOf(row);
        if (!projects.includes(projectKey)) projects.push(projectKey);
      }
      for (const projectKey of projects) {
        const projectRows = rows.filter((row) => input.projectKeyOf(row) === projectKey);
        result.push({
          type: "v2-project-header",
          key: `v2-project:${segmentIndex}:${environmentId}:${projectKey}`,
          projectKey,
          count: projectRows.length,
        });
        result.push(...withGroupDividers(projectRows));
      }
    }
    segment = [];
    segmentIndex += 1;
  };
  for (const item of items) {
    if (isRow(item)) {
      segment.push(item);
      continue;
    }
    flush();
    result.push(item);
  }
  flush();
  return result;
}

// A group ends at a header, so its last row draws no divider and only its first pending row
// labels the unsent tasks.
function withGroupDividers(rows: ReadonlyArray<RowItem>): ReadonlyArray<RowItem> {
  const firstPending = rows.findIndex((row) => row.type === "v2-pending");
  return rows.map((row, index) => {
    const showTrailingDivider = index < rows.length - 1;
    if (row.type === "v2-thread") {
      return row.showTrailingDivider === showTrailingDivider
        ? row
        : { ...row, showTrailingDivider };
    }
    const showPendingDivider = index === firstPending && row.showPendingDivider;
    return row.showTrailingDivider === showTrailingDivider &&
      row.showPendingDivider === showPendingDivider
      ? row
      : { ...row, showTrailingDivider, showPendingDivider };
  });
}

export function homeThreadListItemsAreEqual(
  previous: HomeThreadListItem,
  item: HomeThreadListItem,
): boolean {
  if (item.type === "v2-device-header") {
    return (
      previous.type === "v2-device-header" &&
      previous.key === item.key &&
      previous.count === item.count &&
      previous.collapsed === item.collapsed
    );
  }
  if (item.type === "v2-project-header") {
    return (
      previous.type === "v2-project-header" &&
      previous.key === item.key &&
      previous.count === item.count
    );
  }
  if (previous.type === "v2-device-header" || previous.type === "v2-project-header") return false;
  return threadListV2ListItemsAreEqual(previous, item);
}
