import { useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { workspaceDefinition } from "@t3tools/client-runtime/workspaces";
import { View } from "react-native";

import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import { useWorkspacePreferences } from "./workspacePreferences";

const STUDIO_MENU_LIMIT = 8;

/** In Present and Studio, a way into a recent chat's Studio designs above the list. */
export function WorkspaceStudioShortcut(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const { active } = useWorkspacePreferences();
  const navigation = useNavigation();
  const studioThreads = workspaceDefinition(active).opensStudio
    ? props.threads.filter((thread) => thread.archivedAt === null).slice(0, STUDIO_MENU_LIMIT)
    : [];
  if (studioThreads.length === 0) return null;
  return (
    <View className="flex-row px-5 pb-2 pt-0.5">
      <ListFilterMenu
        label="Studio"
        accessibilityLabel="Open a chat's Studio designs"
        actions={studioThreads.map((thread) => ({
          id: `${thread.environmentId}\u0000${thread.id}`,
          title: thread.title,
        }))}
        onSelect={(id) => {
          const [environmentId, threadId] = id.split("\u0000");
          if (environmentId && threadId) {
            navigation.navigate("ThreadStudio", { environmentId, threadId });
          }
        }}
      />
    </View>
  );
}
