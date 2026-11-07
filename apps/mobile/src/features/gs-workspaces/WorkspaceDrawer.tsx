import {
  WORKSPACES,
  workspaceDefinition,
  type WorkspaceId,
} from "@t3tools/client-runtime/workspaces";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { useWorkspacePreferences } from "./workspacePreferences";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 360;
const SLIDE_MS = 220;

// Closest mobile icons to the desktop rail's.
const WORKSPACE_SYMBOLS: Record<WorkspaceId, AppSymbolName> = {
  code: "chevron.left.forwardslash.chevron.right",
  present: "desktopcomputer",
  studio: "square.grid.2x2",
  research: "magnifyingglass",
  write: "pencil",
  mail: "envelope",
  qa: "checkmark.shield",
};

/** The round ☰ that opens the workspace drawer, the phone's version of the desktop rail. */
export function WorkspaceMenuButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Workspaces"
        hitSlop={6}
        onPress={() => setOpen(true)}
        className="size-9 items-center justify-center rounded-full bg-subtle"
      >
        <SymbolView name="line.3.horizontal" size={17} tintColorClassName="accent-icon" />
      </Pressable>
      {open ? <WorkspaceDrawer onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** ☰ before the thread list's title, which stays the brand or the connection status. */
export function WithWorkspaceMenu(props: {
  readonly children: ReactNode;
  readonly fill?: boolean;
}) {
  return (
    <View className={cn("min-w-0 flex-row items-center gap-2", props.fill && "flex-1")}>
      <WorkspaceMenuButton />
      <View className={cn("min-w-0 flex-row items-center", props.fill && "flex-1")}>
        {props.children}
      </View>
    </View>
  );
}

/** Names the workspace the list is filtered to; Code, the unfiltered home, shows nothing. */
export function WorkspacePill() {
  const { active } = useWorkspacePreferences();
  if (active === "code") return null;
  return (
    <View
      className="rounded-full bg-primary px-2 py-0.5"
      accessibilityLabel={`${workspaceDefinition(active).label} workspace`}
    >
      <Text textRole="caption" numberOfLines={1} className="font-t3-bold text-primary-foreground">
        {workspaceDefinition(active).label}
      </Text>
    </View>
  );
}

function WorkspaceDrawer(props: { readonly onClose: () => void }) {
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={props.onClose}
    >
      {/* A Modal is its own native hierarchy, so it measures its own safe area. */}
      <SafeAreaProvider>
        <WorkspaceDrawerPanel onClose={props.onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

function WorkspaceDrawerPanel(props: { readonly onClose: () => void }) {
  const { active, setActive } = useWorkspacePreferences();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(DRAWER_MAX_WIDTH, Math.round(windowWidth * DRAWER_WIDTH_RATIO));
  const [progress] = useState(() => new Animated.Value(0));
  const closing = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays the one-off slide-in once the drawer mounts
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: SLIDE_MS, useNativeDriver: true }).start();
  }, [progress]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    then?.();
    Animated.timing(progress, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }).start(() =>
      props.onClose(),
    );
  };

  const row = (workspace: (typeof WORKSPACES)[number], hint?: string) => {
    const selected = workspace.id === active;
    return (
      <Pressable
        key={workspace.id}
        accessibilityRole="button"
        accessibilityLabel={`${workspace.label} workspace`}
        accessibilityState={{ selected }}
        onPress={() => close(() => setActive(workspace.id))}
        className={cn(
          "mx-3 flex-row items-center gap-3 rounded-xl px-3 py-3",
          selected && "bg-primary",
        )}
      >
        <SymbolView
          name={WORKSPACE_SYMBOLS[workspace.id]}
          size={18}
          tintColorClassName={selected ? "accent-primary-foreground" : "accent-icon"}
        />
        <Text
          textRole="body"
          className={cn(
            "flex-1 font-t3-medium",
            selected ? "text-primary-foreground" : "text-foreground",
          )}
        >
          {workspace.label}
        </Text>
        {hint ? (
          <Text
            textRole="caption"
            className={selected ? "text-primary-foreground" : "text-foreground-muted"}
          >
            {hint}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const [code, ...others] = WORKSPACES;
  return (
    <View className="flex-1">
      <Animated.View
        className="absolute inset-0"
        style={{
          backgroundColor: "#000",
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }),
        }}
      >
        <Pressable
          className="flex-1"
          accessibilityRole="button"
          accessibilityLabel="Close workspaces"
          onPress={() => close()}
        />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        className="absolute bottom-0 left-0 top-0 border-r border-border bg-sheet-solid"
        style={{
          width,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
          paddingLeft: insets.left,
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) },
          ],
        }}
      >
        <Text
          textRole="label"
          accessibilityRole="header"
          className="mx-6 mb-2 font-t3-bold uppercase text-foreground-muted"
        >
          Workspaces
        </Text>
        {code ? row(code, "All chats") : null}
        <View className="mx-6 my-2 h-px bg-border" />
        {others.map((workspace) => row(workspace))}
        <View className="mx-6 my-2 h-px bg-border" />
        <View
          className="mx-3 flex-row items-center gap-3 px-3 py-3 opacity-50"
          accessibilityLabel="Library, coming soon"
          accessibilityState={{ disabled: true }}
        >
          <SymbolView name="books.vertical" size={18} tintColorClassName="accent-icon-muted" />
          <Text textRole="body" className="flex-1 font-t3-medium text-foreground-muted">
            Library
          </Text>
          <Text textRole="caption" className="text-foreground-muted">
            soon
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
