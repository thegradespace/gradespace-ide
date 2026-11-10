import { CompactBrandTitle } from "../../../components/CompactBrandTitle";
import { WithWorkspaceMenu, WorkspacePill } from "../../gs-workspaces/WorkspaceDrawer";
import { WorkspaceConnectionTitle } from "../../home/WorkspaceConnectionTitle";

/** The title of a workspace list tab: the brand and the connection status. */
export function WorkspaceBrandTitle(props: {
  readonly accessibilityLabel: string;
  readonly onOpenEnvironments: () => void;
  /** The thread list's ☰ and active-workspace pill. */
  readonly workspaceMenu?: boolean;
}) {
  const title = (
    <WorkspaceConnectionTitle
      grow
      onPress={props.onOpenEnvironments}
      brand={
        <CompactBrandTitle
          allowFontScaling={false}
          accessibilityLabel={props.accessibilityLabel}
          fit
          trailing={props.workspaceMenu ? <WorkspacePill /> : undefined}
        />
      }
    />
  );
  return props.workspaceMenu ? <WithWorkspaceMenu fill>{title}</WithWorkspaceMenu> : title;
}
