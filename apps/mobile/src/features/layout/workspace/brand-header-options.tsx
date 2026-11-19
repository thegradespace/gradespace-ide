import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { msg } from "gt-react-native";
import { Platform } from "react-native";

import { brandTitleOffset, CompactBrandTitle } from "../../../components/CompactBrandTitle";
import { WithWorkspaceMenu, WorkspacePill } from "../../gs-workspaces/WorkspaceDrawer";
import { WorkspaceConnectionTitle } from "../../home/WorkspaceConnectionTitle";
import { m, type MessageResolver } from "../../../i18n/messages";

function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
  resolve: MessageResolver = m,
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: resolve(msg("Threads", { $context: "screen title, list of chat threads" })),
    unstable_headerLeftItems: undefined,
  };
}

export function getConnectionAwareBrandHeaderOptions(opts: {
  readonly headerWidth: number;
  readonly trailingItemCount?: number;
  readonly onOpenEnvironments: () => void;
  readonly fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"];
  /** The thread list's ☰ and active-workspace pill. */
  readonly workspaceMenu?: boolean;
  readonly resolve?: MessageResolver;
}): NativeStackNavigationOptions {
  const maxWidth = Math.max(0, opts.headerWidth - 64 - 44 * (opts.trailingItemCount ?? 1));

  return {
    ...getCompactBrandHeaderOptions(opts.fallbackTitleStyle, opts.resolve),
    headerTitle: () => {
      const title = (
        <WorkspaceConnectionTitle
          brand={
            <CompactBrandTitle trailing={opts.workspaceMenu ? <WorkspacePill /> : undefined} />
          }
          maxWidth={opts.workspaceMenu ? maxWidth - 44 : maxWidth}
          onPress={opts.onOpenEnvironments}
          statusOffset={brandTitleOffset()}
        />
      );
      return opts.workspaceMenu ? <WithWorkspaceMenu>{title}</WithWorkspaceMenu> : title;
    },
  };
}
