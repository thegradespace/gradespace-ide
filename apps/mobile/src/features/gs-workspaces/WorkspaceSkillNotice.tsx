import { useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { workspaceSkillNotice } from "@t3tools/client-runtime/workspaces";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListPillButton } from "./MailHome";
import { seedNewTaskDraft, useWorkspacePreferences } from "./workspacePreferences";

/** "<skill> isn't installed on <environment>." with Install and Switch, above a new chat. */
export function WorkspaceSkillNotice(props: {
  readonly draftKey: string | null;
  readonly environmentId: EnvironmentId;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
  }>;
  readonly onSwitchEnvironment: (environmentId: EnvironmentId) => void;
}) {
  const { active, seedSettings } = useWorkspacePreferences();
  const serverConfigs = useServerConfigs();
  const canInstall = useAtomValue(
    serverEnvironment.installSkillPacks.permissionAtom(props.environmentId),
  );
  const install = useAtomCommand(serverEnvironment.installSkillPacks, { reportFailure: false });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [installing, setInstalling] = useState(false);

  const labelOf = (environmentId: EnvironmentId) =>
    props.environments.find((environment) => environment.environmentId === environmentId)
      ?.environmentLabel ?? "this environment";
  const notice = workspaceSkillNotice({
    workspace: active,
    settings: seedSettings,
    environmentId: props.environmentId,
    environments: [
      props.environmentId,
      ...props.environments
        .map((environment) => environment.environmentId)
        .filter((id) => id !== props.environmentId),
    ].map((environmentId) => ({
      environmentId,
      label: labelOf(environmentId),
      providers: serverConfigs.get(environmentId)?.providers ?? [],
    })),
  });
  if (notice === null) return null;

  const alternative =
    props.environments.find(
      (environment) => environment.environmentId === notice.alternative?.environmentId,
    ) && notice.alternative
      ? {
          environmentId: notice.alternative.environmentId as EnvironmentId,
          label: notice.alternative.label,
        }
      : null;
  const installable =
    canInstall &&
    serverConfigs.get(props.environmentId)?.environment.capabilities.skillPacks === true;
  const runInstall = async () => {
    setInstalling(true);
    const environmentId = props.environmentId;
    const installed = await install({ environmentId, input: { names: [notice.skill] } });
    if (installed._tag !== "Success") {
      setInstalling(false);
      if (!isAtomCommandInterrupted(installed)) {
        Dialog.alert(
          `Could not install ${notice.skill}`,
          `Try again, or install it from Settings → Skills on ${notice.environmentLabel} in the desktop app.`,
        );
      }
      return;
    }
    // Skills are read with the provider snapshot, so a refresh is what makes the new one show.
    const refreshed = await refreshProviders({ environmentId, input: {} });
    setInstalling(false);
    if (refreshed._tag === "Success" && props.draftKey !== null) {
      seedNewTaskDraft(props.draftKey, refreshed.value.providers);
    }
  };

  return (
    <View
      accessibilityRole="summary"
      className="mx-3 mb-2 gap-2 rounded-2xl border border-border bg-card px-3.5 py-3"
    >
      <Text textRole="footnote" className="font-t3-medium text-foreground">
        {notice.skill} isn't installed on {notice.environmentLabel}.
      </Text>
      {installable ? null : (
        <Text textRole="footnote" className="text-foreground-muted">
          Install it from Settings → Skills on {notice.environmentLabel} in the desktop app.
        </Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {installable ? (
          <ListPillButton
            label={installing ? "Installing…" : "Install"}
            accessibilityLabel={`Install ${notice.skill} on ${notice.environmentLabel}`}
            disabled={installing}
            onPress={() => void runInstall()}
          />
        ) : null}
        {alternative ? (
          <ListPillButton
            label={`Switch to ${alternative.label}`}
            accessibilityLabel={`Start this chat on ${alternative.label}, which has ${notice.skill}`}
            disabled={installing}
            onPress={() => props.onSwitchEnvironment(alternative.environmentId)}
          />
        ) : null}
      </View>
    </View>
  );
}
