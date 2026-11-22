import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { memo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

export const ThreadListDeviceHeader = memo(function ThreadListDeviceHeader(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind | undefined;
  readonly count: number;
  readonly collapsed: boolean;
  readonly pane?: "screen" | "sidebar";
  readonly onToggle: (environmentId: EnvironmentId) => void;
}) {
  const sidebarPane = props.pane === "sidebar";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}, ${props.count} ${props.count === 1 ? "thread" : "threads"}`}
      accessibilityHint={`${props.collapsed ? "Shows" : "Hides"} this device's threads.`}
      accessibilityState={{ expanded: !props.collapsed }}
      className={cn("mb-1 mt-5 flex-row items-center gap-2", sidebarPane ? "px-3" : "px-5")}
      onPress={() => props.onToggle(props.environmentId)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {props.machine ? (
        <EnvironmentMachineSymbol
          kind={props.machine}
          size={14}
          tintColorClassName={sidebarPane ? "accent-drawer-foreground" : "accent-foreground"}
        />
      ) : null}
      <Text
        className={cn(
          "shrink text-sm font-t3-bold",
          sidebarPane ? "text-drawer-foreground" : "text-foreground",
        )}
        numberOfLines={1}
      >
        {props.label}
      </Text>
      <Text
        className={cn(
          "text-xs",
          sidebarPane ? "text-drawer-foreground-muted" : "text-foreground-tertiary",
        )}
      >
        {props.count}
      </Text>
      <View className={cn("h-px flex-1", sidebarPane ? "bg-drawer-border" : "bg-border")} />
      <SymbolView
        name="chevron.down"
        size={10}
        tintColorClassName={
          sidebarPane ? "accent-drawer-foreground-muted" : "accent-foreground-muted"
        }
        type="monochrome"
        style={{ transform: [{ rotate: props.collapsed ? "-90deg" : "0deg" }] }}
      />
    </Pressable>
  );
});

export const ThreadListProjectHeader = memo(function ThreadListProjectHeader(props: {
  readonly title: string;
  readonly count: number;
  readonly pane?: "screen" | "sidebar";
}) {
  const sidebarPane = props.pane === "sidebar";
  return (
    <View
      className={cn("mb-0.5 mt-2 flex-row items-center gap-1.5", sidebarPane ? "px-3" : "px-5")}
    >
      <Text
        className={cn(
          "text-xs font-t3-medium",
          sidebarPane ? "text-drawer-foreground-muted" : "text-foreground-secondary",
        )}
        numberOfLines={1}
      >
        {props.title}
      </Text>
      <Text
        className={cn(
          "text-xs",
          sidebarPane ? "text-drawer-foreground-muted" : "text-foreground-tertiary",
        )}
      >
        · {props.count}
      </Text>
    </View>
  );
});

export function ThreadListDeviceChips(props: {
  readonly devices: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly gutter: number;
}) {
  const chip = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "rounded-full border px-3 py-1.5",
        selected ? "border-transparent bg-primary" : "border-border bg-transparent",
      )}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Text
        className={cn(
          "text-xs font-t3-medium",
          selected ? "text-primary-foreground" : "text-foreground-secondary",
        )}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -props.gutter, overflow: "visible" }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      {chip("all", "All devices", props.selectedEnvironmentId === null, () =>
        props.onEnvironmentChange(null),
      )}
      {props.devices.map((device) =>
        chip(
          device.environmentId,
          device.label,
          device.environmentId === props.selectedEnvironmentId,
          () => props.onEnvironmentChange(device.environmentId),
        ),
      )}
    </ScrollView>
  );
}
