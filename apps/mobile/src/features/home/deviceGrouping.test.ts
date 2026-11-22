import { describe, expect, it } from "vite-plus/test";

import type { ThreadListV2ListItem } from "../threads/threadListV2";
import { groupThreadListByDevice, type HomeThreadListItem } from "./deviceGrouping";

const thread = (id: string, environmentId: string, projectId = "p") =>
  ({
    type: "v2-thread",
    key: id,
    item: { thread: { id, environmentId, projectId } },
    showTrailingDivider: true,
  }) as unknown as ThreadListV2ListItem;

const settledShelf = {
  type: "v2-settled-shelf",
  key: "v2-settled-shelf",
  count: 2,
  expanded: true,
  disabled: false,
} as const satisfies ThreadListV2ListItem;

const shape = (items: ReadonlyArray<HomeThreadListItem>) =>
  items.map((item) =>
    item.type === "v2-device-header"
      ? `[${item.environmentId} ${item.count}${item.collapsed ? " folded" : ""}]`
      : item.type === "v2-project-header"
        ? `(${item.projectKey})`
        : item.type === "v2-thread"
          ? `${item.key}${item.showTrailingDivider ? "" : "."}`
          : item.type,
  );

const projectKeyOf = (row: Extract<ThreadListV2ListItem, { type: "v2-thread" | "v2-pending" }>) =>
  row.type === "v2-thread" ? row.item.thread.projectId : row.pendingTask.projectId;

describe("groupThreadListByDevice", () => {
  const items = [
    thread("t1", "air"),
    thread("t2", "pro"),
    thread("t3", "air"),
    settledShelf,
    thread("t4", "pro"),
    thread("t5", "air"),
  ];

  it("splits each shelf into device sections, most recently active device first", () => {
    const grouped = groupThreadListByDevice(items, {
      layout: "sections",
      collapsedDevices: new Set(),
      projectKeyOf,
    });
    expect(shape(grouped)).toEqual([
      "[air 2]",
      "t1",
      "t3.",
      "[pro 1]",
      "t2.",
      "v2-settled-shelf",
      "[air 1]",
      "t5.",
      "[pro 1]",
      "t4.",
    ]);
    expect(new Set(grouped.map((item) => item.key)).size).toBe(grouped.length);
  });

  it("hides a folded device's rows but keeps its header and count", () => {
    const grouped = groupThreadListByDevice(items, {
      layout: "sections",
      collapsedDevices: new Set(["air"]),
      projectKeyOf,
    });
    expect(shape(grouped)).toEqual([
      "[air 2 folded]",
      "[pro 1]",
      "t2.",
      "v2-settled-shelf",
      "[air 1 folded]",
      "[pro 1]",
      "t4.",
    ]);
  });

  it("groups by project inside each device", () => {
    const grouped = groupThreadListByDevice(
      [
        thread("t1", "air", "web"),
        thread("t2", "pro", "web"),
        thread("t3", "air", "api"),
        thread("t4", "air", "web"),
      ],
      { layout: "device-project", collapsedDevices: new Set(), projectKeyOf },
    );
    expect(shape(grouped)).toEqual([
      "[air 3]",
      "(web)",
      "t1",
      "t4.",
      "(api)",
      "t3.",
      "[pro 1]",
      "(web)",
      "t2.",
    ]);
  });

  it("leaves the list alone for one device and for the filter and colour layouts", () => {
    const oneDevice = [thread("t1", "air"), thread("t2", "air")];
    const options = { collapsedDevices: new Set<string>(), projectKeyOf };
    expect(groupThreadListByDevice(oneDevice, { ...options, layout: "sections" })).toBe(oneDevice);
    expect(groupThreadListByDevice(items, { ...options, layout: "filter" })).toBe(items);
    expect(groupThreadListByDevice(items, { ...options, layout: "color" })).toBe(items);
  });
});
