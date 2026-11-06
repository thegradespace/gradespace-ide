import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { SkillPackAgent, SkillPackSkillStatus } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import * as Cause from "effect/Cause";
import { useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { ScopedSwitch } from "./ScopedSwitch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type ScopedEnvironment = ReturnType<typeof useSettingsScope>["connectedEnvironments"][number];

const AGENT_LABELS: Record<SkillPackAgent, string> = { claude: "Claude", codex: "Codex" };

const failureMessage = (cause: unknown) =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : "Something went wrong.";

function agentStateLabel(
  skill: SkillPackSkillStatus,
  agent: SkillPackSkillStatus["agents"][number],
) {
  const name = AGENT_LABELS[agent.agent];
  switch (agent.state) {
    case "notInstalled":
      return `${name}: not installed`;
    case "installed":
      return `${name}: installed v${agent.installedVersion}`;
    case "updateAvailable":
      return `${name}: update available (v${agent.installedVersion} to v${skill.latestVersion})`;
    case "outsideApp":
      return `${name}: managed outside the app`;
  }
}

function EnvironmentSkills({
  environment,
  label,
}: {
  environment: ScopedEnvironment;
  label: string;
}) {
  const { environmentId } = environment;
  const statusQuery = serverEnvironment.skillPacksStatus({ environmentId, input: {} });
  const status = useAtomValue(statusQuery);
  const refresh = useAtomRefresh(statusQuery);
  const install = useAtomCommand(serverEnvironment.installSkillPacks, { reportFailure: false });
  const update = useAtomCommand(serverEnvironment.updateSkillPacks, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.removeSkillPacks, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.installSkillPacks.permissionAtom(environmentId));
  const [pending, setPending] = useState<string | null>(null);

  const run = async <A,>(
    key: string,
    start: () => Promise<AtomCommandResult<A, unknown>>,
    success: string,
    failure: string,
  ) => {
    if (pending !== null) return;
    setPending(key);
    const result = await start().finally(() => setPending(null));
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: success });
    } else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: `${failure} on ${label}`,
        description: failureMessage(squashAtomCommandFailure(result)),
      });
    }
    refresh();
  };

  if (status._tag !== "Success") {
    return (
      <SettingsRow
        title={status.waiting ? "Checking for skills…" : "Could not load skills"}
        description={status._tag === "Failure" ? failureMessage(Cause.squash(status.cause)) : null}
        control={
          status._tag === "Failure" ? (
            <Button variant="outline" size="sm" onClick={refresh}>
              Try again
            </Button>
          ) : undefined
        }
      />
    );
  }

  const { agents, skills, manifestError } = status.value;
  const available = agents.filter((agent) => agent.available);
  const outdated = skills.some((skill) =>
    skill.agents.some((agent) => agent.state === "updateAvailable"),
  );
  const busy = !allowed || pending !== null;

  return (
    <>
      <SettingsRow
        title={`Agent folders on ${label}`}
        description={
          available.length === 0
            ? "Neither Claude nor Codex is set up on this machine. Sign in to one in Providers first."
            : `Skills install on ${label} into ${available
                .map((agent) => `${AGENT_LABELS[agent.agent]} (${agent.skillsDirectory})`)
                .join(" and ")}.`
        }
        control={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending !== null || status.waiting}
              onClick={refresh}
            >
              {status.waiting && <Spinner size="sm" />}
              Check for updates
            </Button>
            <Button
              size="sm"
              disabled={busy || !outdated}
              onClick={() =>
                void run(
                  "update-all",
                  () => update({ environmentId, input: {} }),
                  "Skills updated",
                  "Could not update skills",
                )
              }
            >
              {pending === "update-all" && <Spinner size="sm" />}
              Update all
            </Button>
          </div>
        }
      />
      {manifestError !== null && (
        <SettingsRow title="Could not load the skill pack" description={manifestError} />
      )}
      {manifestError === null && skills.length === 0 && (
        <SettingsRow title="No skills in the pack yet" />
      )}
      {skills.map((skill) => {
        const installable =
          skill.latestVersion !== null &&
          skill.agents.some((agent) => agent.state === "notInstalled");
        const updatable = skill.agents.some((agent) => agent.state === "updateAvailable");
        const removable = skill.agents.some(
          (agent) => agent.state === "installed" || agent.state === "updateAvailable",
        );
        const states = skill.agents.map((agent) => agentStateLabel(skill, agent)).join(" · ");
        return (
          <SettingsRow
            key={skill.name}
            title={
              skill.latestVersion === null ? skill.name : `${skill.name} v${skill.latestVersion}`
            }
            description={
              <>
                {skill.description.length > 0 && <span className="block">{skill.description}</span>}
                {skill.latestVersion === null && manifestError === null && (
                  <span className="block">No longer in the skill pack.</span>
                )}
                {states.length > 0 && <span className="block">{states}</span>}
              </>
            }
            control={
              <div className="flex items-center gap-2">
                {installable && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        `install:${skill.name}`,
                        () => install({ environmentId, input: { names: [skill.name] } }),
                        `Installed ${skill.name}`,
                        `Could not install ${skill.name}`,
                      )
                    }
                  >
                    {pending === `install:${skill.name}` && <Spinner size="sm" />}
                    Install
                  </Button>
                )}
                {updatable && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        `update:${skill.name}`,
                        () => update({ environmentId, input: { names: [skill.name] } }),
                        `Updated ${skill.name}`,
                        `Could not update ${skill.name}`,
                      )
                    }
                  >
                    {pending === `update:${skill.name}` && <Spinner size="sm" />}
                    Update
                  </Button>
                )}
                {removable && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        `remove:${skill.name}`,
                        () => remove({ environmentId, input: { names: [skill.name] } }),
                        `Removed ${skill.name}`,
                        `Could not remove ${skill.name}`,
                      )
                    }
                  >
                    {pending === `remove:${skill.name}` && <Spinner size="sm" />}
                    Remove
                  </Button>
                )}
              </div>
            }
          />
        );
      })}
    </>
  );
}

export function SkillsSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { connectedEnvironments } = useSettingsScope();
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.skillPacks === true,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection id="skills-updates" title="Gradespace skills">
        <SettingsRow
          serverScoped
          settingKeys={["keepSkillsUpToDate"]}
          {...searchableSetting("skills-keep-up-to-date")}
          description="Once a day, update the skills installed from here. New skills are never installed on their own, and folders you manage yourself are never changed."
          resetAction={
            settings.keepSkillsUpToDate !== DEFAULT_UNIFIED_SETTINGS.keepSkillsUpToDate ? (
              <SettingResetButton
                label="keep skills up to date"
                onClick={() =>
                  updateSettings({
                    keepSkillsUpToDate: DEFAULT_UNIFIED_SETTINGS.keepSkillsUpToDate,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["keepSkillsUpToDate"]}
              checked={settings.keepSkillsUpToDate}
              onCheckedChange={(checked) =>
                updateSettings({ keepSkillsUpToDate: Boolean(checked) })
              }
              aria-label="Keep skills up to date"
            />
          }
        />
      </SettingsSection>
      {supported.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">
          Connect an environment running this version of the app to install skills.
        </p>
      ) : (
        supported.map((environment) => {
          const label = settingsScopeEnvironmentLabel(environment, connectedEnvironments);
          return (
            <SettingsSection key={environment.environmentId} title={`Skills on ${label}`}>
              <EnvironmentSkills environment={environment} label={label} />
            </SettingsSection>
          );
        })
      )}
    </SettingsPageContainer>
  );
}
