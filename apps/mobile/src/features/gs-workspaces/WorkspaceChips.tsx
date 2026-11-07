import { useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { WORKSPACES, workspaceDefinition } from "@t3tools/client-runtime/workspaces";
import { Pressable, ScrollView } from "react-native";

import { Chip } from "../../components/ui/Chip";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import { useWorkspacePreferences } from "./workspacePreferences";

const STUDIO_MENU_LIMIT = 8;

/** The desktop rail as a chip row; Present and Studio add a way into a recent chat's Studio sets. */
export function WorkspaceChips(props: {
  readonly gutter: number;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const { active, setActive } = useWorkspacePreferences();
  const { themeAppearance } = useAppearancePreferences();
  const navigation = useNavigation();
  const studioThreads = workspaceDefinition(active).opensStudio
    ? props.threads.filter((thread) => thread.archivedAt === null).slice(0, STUDIO_MENU_LIMIT)
    : [];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -props.gutter }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 8, gap: 8 }}
      accessibilityRole="tablist"
    >
      {WORKSPACES.map((workspace) => (
        <Pressable
          key={workspace.id}
          accessibilityRole="tab"
          accessibilityLabel={`${workspace.label} workspace`}
          accessibilityState={{ selected: workspace.id === active }}
          hitSlop={4}
          onPress={() => setActive(workspace.id)}
        >
          <Chip
            label={workspace.label}
            selected={workspace.id === active}
            glass
            colorScheme={themeAppearance}
          />
        </Pressable>
      ))}
      {studioThreads.length > 0 ? (
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
      ) : null}
    </ScrollView>
  );
}
