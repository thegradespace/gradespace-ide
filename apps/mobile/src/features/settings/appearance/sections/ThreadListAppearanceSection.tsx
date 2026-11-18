import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/ui/AppText";
import { cn } from "../../../../lib/cn";
import type { ThreadListDeviceLayout } from "../../../../persistence/mobile-preferences";
import { useThreadListDeviceLayout } from "../../../home/use-thread-list-device-layout";

const LAYOUTS: ReadonlyArray<{
  readonly value: ThreadListDeviceLayout;
  readonly label: string;
  readonly detail: string;
}> = [
  { value: "sections", label: "Sections", detail: "A section per device" },
  { value: "filter", label: "Filter", detail: "One device at a time" },
  { value: "color", label: "Colour", detail: "One timeline, coloured" },
  { value: "device-project", label: "Device, project", detail: "Projects inside devices" },
];

const COLORS = ["#3b82f6", "#f59e0b"] as const;

function Row(props: { readonly width?: `${number}%`; readonly color?: string }) {
  return (
    <View
      className="flex-row items-center gap-1 py-[3px]"
      style={
        props.color
          ? { borderLeftWidth: 2, borderLeftColor: props.color, paddingLeft: 3 }
          : undefined
      }
    >
      <View className="size-2 rounded-[3px] bg-subtle-strong" />
      <View
        className="h-1.5 rounded-full bg-foreground-muted"
        style={{ width: props.width ?? "62%" }}
      />
      {props.color ? (
        <View className="ml-auto h-1.5 w-3 rounded-full" style={{ backgroundColor: props.color }} />
      ) : null}
    </View>
  );
}

function Header(props: { readonly width?: `${number}%` }) {
  return (
    <View className="mt-1 flex-row items-center gap-1 pb-0.5">
      <View className="size-1.5 rounded-full bg-adaptive-emerald-600-400" />
      <View className="h-1.5 rounded-full bg-foreground" style={{ width: props.width ?? "40%" }} />
      <View className="ml-1 h-px flex-1 bg-border" />
    </View>
  );
}

function Subheader(props: { readonly width?: `${number}%` }) {
  return (
    <View
      className="ml-1 mt-0.5 h-1 rounded-full bg-foreground-tertiary"
      style={{ width: props.width ?? "30%" }}
    />
  );
}

function Thumbnail(props: { readonly layout: ThreadListDeviceLayout }) {
  return (
    <View className="h-[92px] overflow-hidden rounded-[14px] border border-border bg-screen px-2 py-1.5">
      {props.layout === "sections" ? (
        <>
          <Header />
          <Row />
          <Row width="48%" />
          <Header width="52%" />
          <Row width="56%" />
          <Row width="40%" />
        </>
      ) : props.layout === "filter" ? (
        <>
          <View className="mb-1 flex-row gap-1">
            <View className="h-2.5 w-7 rounded-full bg-primary" />
            <View className="h-2.5 w-6 rounded-full border border-border" />
            <View className="h-2.5 w-5 rounded-full border border-border" />
          </View>
          <Row />
          <Row width="48%" />
          <Row width="56%" />
          <Row width="40%" />
        </>
      ) : props.layout === "color" ? (
        <>
          <Row color={COLORS[0]} />
          <Row width="48%" color={COLORS[1]} />
          <Row width="56%" color={COLORS[1]} />
          <Row width="40%" color={COLORS[0]} />
          <Row width="52%" color={COLORS[1]} />
        </>
      ) : (
        <>
          <Header />
          <Subheader />
          <Row width="54%" />
          <Subheader width="22%" />
          <Row width="44%" />
          <Header width="52%" />
        </>
      )}
    </View>
  );
}

export function ThreadListAppearanceSection() {
  const { loaded, layout, setLayout } = useThreadListDeviceLayout();
  return (
    <View className="gap-3">
      <Text className="px-2 text-sm font-t3-medium text-foreground-muted">
        Threads from several devices
      </Text>
      <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-3">
        {LAYOUTS.map((option) => {
          const selected = loaded && layout === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityLabel={`${option.label}: ${option.detail}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: !loaded }}
              className={cn(
                "min-w-36 flex-1 basis-[47%] gap-2 rounded-[24px] p-2 active:scale-[0.97]",
                selected
                  ? "border-2 border-primary bg-subtle"
                  : "border border-border bg-grouped-card",
              )}
              disabled={!loaded}
              onPress={() => setLayout(option.value)}
            >
              <Thumbnail layout={option.value} />
              <View className="px-1 pb-1">
                <Text
                  className={
                    selected
                      ? "text-base font-t3-bold text-foreground"
                      : "text-base text-foreground-muted"
                  }
                >
                  {option.label}
                </Text>
                <Text className="text-xs text-foreground-tertiary">{option.detail}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text className="px-2 text-sm text-foreground-muted">
        How the thread list tells your computers apart when you connect to more than one. Tap a
        device's section header to fold it.
      </Text>
    </View>
  );
}
