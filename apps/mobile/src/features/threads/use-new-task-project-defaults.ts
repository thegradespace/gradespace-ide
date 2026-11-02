import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectReadFileResult } from "@t3tools/contracts";
import {
  DEFAULT_SERVER_SETTINGS,
  GS_PROJECT_FILE_NAME,
  T3_PROJECT_FILE_NAME,
} from "@t3tools/contracts";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { parseT3ProjectFile, pickProjectFileRead } from "@t3tools/shared/t3ProjectFile";

import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useProjectHasThreads } from "../../state/project-has-threads";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";

function useProjectFileRead(
  project: EnvironmentProject | null,
  enabled: boolean,
  relativePath: string,
) {
  return useEnvironmentQuery(
    enabled && project !== null
      ? projectEnvironment.readFile({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot, relativePath, allowMissing: true },
        })
      : null,
  );
}

/**
 * A project's new-task defaults: server settings merged with its gs.json or t3.json. The
 * new-task flow and the home pending-drafts list both read the default
 * workspace mode here, so a draft that never picked one shows what it sends.
 * Every read is a shared per-environment or per-project atom.
 */
export function useNewTaskProjectDefaults(project: EnvironmentProject | null) {
  const serverConfig = useEnvironmentServerConfig(project?.environmentId ?? null);
  const isScratch =
    project !== null && isScratchProject(project, serverConfig?.scratchWorkspaceRoot);
  const hasWorkspace = project !== null && project.workspaceRoot !== "";
  const fileAccessSession = useEnvironmentQuery(
    hasWorkspace ? environmentSession.sessionStateAtom(project.environmentId) : null,
  );
  const fileEnvironment = useEnvironmentPresentation(project?.environmentId ?? null);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const fileAccessPending = hasWorkspace && fileAccess.isPending;
  const canReadProjectFile = fileAccess.canReadFiles && hasWorkspace;
  const gsProjectFileQuery = useProjectFileRead(project, canReadProjectFile, GS_PROJECT_FILE_NAME);
  const t3ProjectFileQuery = useProjectFileRead(project, canReadProjectFile, T3_PROJECT_FILE_NAME);
  const t3ProjectFileData = pickProjectFileRead({
    [GS_PROJECT_FILE_NAME]: gsProjectFileQuery.data as ProjectReadFileResult | null,
    [T3_PROJECT_FILE_NAME]: t3ProjectFileQuery.data as ProjectReadFileResult | null,
  });
  const t3ProjectFile =
    t3ProjectFileData === null || t3ProjectFileData.truncated
      ? null
      : parseT3ProjectFile(t3ProjectFileData.contents);
  const projectSettings = resolveProjectSettings(
    serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
    project?.id ?? null,
    project,
    t3ProjectFile,
  );
  const projectHasThreads = useProjectHasThreads(project);
  const defaultWorkspaceMode = isScratch
    ? "local"
    : resolveNewThreadEnvMode({
        projectSettings,
        workspaceRoot: project?.workspaceRoot ?? null,
        newProjectsRoot: serverConfig?.newProjectsRoot,
        projectHasThreads,
      });
  // While the project file loads, the environment default is provisional; it may replace it.
  const defaultWorkspaceModeSettled =
    projectSettings.sources.defaultThreadEnvMode !== "environment" ||
    (!gsProjectFileQuery.isPending && !t3ProjectFileQuery.isPending && !fileAccessPending);
  return {
    serverConfig,
    isScratch,
    projectSettings,
    defaultWorkspaceMode,
    defaultWorkspaceModeSettled,
  };
}
