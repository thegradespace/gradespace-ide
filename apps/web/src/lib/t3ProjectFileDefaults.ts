import {
  GS_PROJECT_FILE_NAME,
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectFileName,
  type ProjectReadFileResult,
  type T3ProjectFile,
} from "@t3tools/contracts";
import { parseT3ProjectFile, pickProjectFileRead } from "@t3tools/shared/t3ProjectFile";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

function toT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
  results: Readonly<Record<ProjectFileName, ProjectReadFileResult | null>>,
): T3ProjectFile | null {
  const resolve = (name: ProjectFileName) =>
    resolveProjectFileQueryData(environmentId, workspaceRoot, name, results[name]);
  const data = pickProjectFileRead({
    [GS_PROJECT_FILE_NAME]: resolve(GS_PROJECT_FILE_NAME),
    [T3_PROJECT_FILE_NAME]: resolve(T3_PROJECT_FILE_NAME),
  });
  if (data === null || data.truncated) return null;
  return parseT3ProjectFile(data.contents);
}

export async function readT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<T3ProjectFile | null> {
  const read = async (name: ProjectFileName) => {
    const result = await executeAtomQuery(
      appAtomRegistry,
      getProjectFileQueryAtom(environmentId, workspaceRoot, name),
      { reportDefect: false, reportFailure: false },
    );
    return result._tag === "Success" ? result.value : null;
  };
  const [gs, t3] = await Promise.all([read(GS_PROJECT_FILE_NAME), read(T3_PROJECT_FILE_NAME)]);
  return toT3ProjectFile(environmentId, workspaceRoot, {
    [GS_PROJECT_FILE_NAME]: gs,
    [T3_PROJECT_FILE_NAME]: t3,
  });
}

/** The project's gs.json or t3.json from an earlier read, or `undefined` until both have loaded. */
export function peekT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): T3ProjectFile | null | undefined {
  const peek = (name: ProjectFileName) =>
    appAtomRegistry.get(getProjectFileQueryAtom(environmentId, workspaceRoot, name));
  const gs = peek(GS_PROJECT_FILE_NAME);
  const t3 = peek(T3_PROJECT_FILE_NAME);
  if (!AsyncResult.isSuccess(gs) || !AsyncResult.isSuccess(t3)) return undefined;
  return toT3ProjectFile(environmentId, workspaceRoot, {
    [GS_PROJECT_FILE_NAME]: gs.value,
    [T3_PROJECT_FILE_NAME]: t3.value,
  });
}
