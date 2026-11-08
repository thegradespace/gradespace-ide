import { DEFAULT_WORKSPACE_ID } from "@t3tools/client-runtime/workspaces";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects, projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { workspaceConnections } from "../../state/workspace";
import {
  latestThreadEnvironmentIds,
  promptLinkScratchEnvironmentId,
} from "../prompt-links/prompt-link-model";
import { readActiveWorkspace } from "./workspacePreferences";

/**
 * Outside Code, a new chat starts without a project rather than in the open thread's,
 * on that thread's machine when it can. Null means start as Code does.
 */
export async function openWorkspaceScratchProject(
  preferredEnvironmentId: string | undefined,
): Promise<EnvironmentProject | null> {
  if (readActiveWorkspace() === DEFAULT_WORKSPACE_ID) return null;
  const serverConfigs = appAtomRegistry.get(environmentServerConfigsAtom);
  const scratchEnvironmentIds = appAtomRegistry
    .get(workspaceConnections.environmentsAtom)
    .filter(
      (environment) =>
        availableScratchWorkspaceRoot(
          environment.connectionState,
          serverConfigs.get(environment.environmentId),
        ) !== null,
    )
    .map((environment) => environment.environmentId);
  const environmentId =
    scratchEnvironmentIds.find((id) => id === preferredEnvironmentId) ??
    promptLinkScratchEnvironmentId(
      latestThreadEnvironmentIds(appAtomRegistry.get(environmentThreadShells.threadShellsAtom)),
      scratchEnvironmentIds,
    );
  if (environmentId === null) return null;
  const scratchRoot = serverConfigs.get(environmentId)?.scratchWorkspaceRoot;
  const existing = appAtomRegistry
    .get(environmentProjects.projectsAtom)
    .find(
      (project) =>
        project.environmentId === environmentId && isScratchProject(project, scratchRoot),
    );
  if (existing) return existing;
  const result = await runAtomCommand(
    appAtomRegistry,
    projectEnvironment.openScratch,
    { environmentId, input: {} },
    { reportFailure: false },
  );
  return result._tag === "Success" ? result.value : null;
}
