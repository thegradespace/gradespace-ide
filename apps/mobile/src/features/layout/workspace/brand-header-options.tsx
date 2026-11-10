import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Platform } from "react-native";

import { brandTitleOffset, CompactBrandTitle } from "../../../components/CompactBrandTitle";
import { WithWorkspaceMenu, WorkspacePill } from "../../gs-workspaces/WorkspaceDrawer";
import { WorkspaceConnectionTitle } from "../../home/WorkspaceConnectionTitle";

function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: "Threads",
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
}): NativeStackNavigationOptions {
  const maxWidth = Math.max(0, opts.headerWidth - 64 - 44 * (opts.trailingItemCount ?? 1));

  return {
    ...getCompactBrandHeaderOptions(opts.fallbackTitleStyle),
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
