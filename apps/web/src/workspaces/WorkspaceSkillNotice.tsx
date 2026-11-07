import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { PuzzleIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  isWorkspaceSeedPrompt,
  type WorkspaceId,
  workspaceSeedPrompt,
  workspaceSkillNotice,
} from "./workspaces.logic";

const failureMessage = (cause: unknown) =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : "Something went wrong.";

/** Says so when the workspace's skill is missing here, instead of starting the chat blank. */
export function WorkspaceSkillNotice(props: {
  workspace: WorkspaceId;
  environmentId: EnvironmentId;
  composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const writeMode = useClientSettings((settings) => settings.writeMode);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const { environments } = useEnvironments();
  const projects = useProjects();
  const openProjectDraft = useNewThreadHandler();
  const { startScratchThread, scratchWorkspaceRootFor } = useScratchProject();
  const install = useAtomCommand(serverEnvironment.installSkillPacks, { reportFailure: false });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const canInstall = useAtomValue(
    serverEnvironment.installSkillPacks.permissionAtom(props.environmentId),
  );
  const [installing, setInstalling] = useState(false);

  const notice = workspaceSkillNotice({
    workspace: props.workspace,
    settings: { writeMode },
    environmentId: props.environmentId,
    environments: environments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      providers: serverConfigs.get(environment.environmentId)?.providers ?? [],
    })),
  });
  if (notice === null) return null;
  const installable =
    canInstall && serverConfigs.get(props.environmentId)?.environment.capabilities.skillPacks;

  const reseed = (providers: ReadonlyArray<ServerProvider>) => {
    const drafts = useComposerDraftStore.getState();
    const prompt = drafts.getComposerDraft(props.composerDraftTarget)?.prompt ?? "";
    if (prompt.trim() !== "" && !isWorkspaceSeedPrompt(prompt)) return;
    drafts.setPrompt(
      props.composerDraftTarget,
      workspaceSeedPrompt(props.workspace, providers, getClientSettings()),
    );
  };

  const onInstall = async () => {
    if (installing) return;
    setInstalling(true);
    const result = await install({
      environmentId: props.environmentId,
      input: { names: [notice.skill] },
    });
    if (result._tag !== "Success") {
      setInstalling(false);
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: `Could not install ${notice.skill} on ${notice.environmentLabel}`,
          description: failureMessage(squashAtomCommandFailure(result)),
        });
      }
      return;
    }
    // Providers list skills from disk; ask them to look again so the chat can start with it.
    const refreshed = await refreshProviders({ environmentId: props.environmentId, input: {} });
    setInstalling(false);
    if (refreshed._tag === "Success") reseed(refreshed.value.providers);
    toastManager.add({
      type: "success",
      title: `${notice.skill} installed on ${notice.environmentLabel}`,
    });
  };

  const onSwitch = (environmentId: EnvironmentId) => {
    const target =
      typeof props.composerDraftTarget === "string"
        ? useComposerDraftStore.getState().getDraftSession(props.composerDraftTarget)
        : null;
    const grouping = selectProjectGroupingSettings(getClientSettings());
    const sameProject =
      target === null
        ? undefined
        : projects.find(
            (project) =>
              project.environmentId === environmentId &&
              deriveLogicalProjectKeyFromSettings(project, grouping) === target.logicalProjectKey,
          );
    if (sameProject) {
      void openProjectDraft(scopeProjectRef(environmentId, sameProject.id));
    } else if (scratchWorkspaceRootFor(environmentId) !== null) {
      void startScratchThread(environmentId);
    } else {
      const anyProject = projects.find((project) => project.environmentId === environmentId);
      if (anyProject) void openProjectDraft(scopeProjectRef(environmentId, anyProject.id));
    }
  };

  const alternative = notice.alternative;
  return (
    <Alert variant="warning" controlAlignment="first-line" aria-live="polite">
      <PuzzleIcon aria-hidden />
      <AlertTitle>
        {notice.skill} isn't installed on {notice.environmentLabel}.
      </AlertTitle>
      <AlertDescription>
        {installable
          ? "New chats here start without it. Install it to start them with it."
          : "New chats here start without it. Install it from Settings, Skills on that environment."}
      </AlertDescription>
      <AlertAction>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {alternative ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onSwitch(alternative.environmentId as EnvironmentId)}
            >
              Switch to {alternative.label}
            </Button>
          ) : null}
          {installable ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={installing}
              aria-label={`Install ${notice.skill} on ${notice.environmentLabel}`}
              onClick={() => void onInstall()}
            >
              {installing ? "Installing…" : "Install"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              render={<Link to="/settings/skills" />}
            >
              Open Skills
            </Button>
          )}
        </div>
      </AlertAction>
    </Alert>
  );
}
