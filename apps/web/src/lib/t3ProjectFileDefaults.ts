import {
  GS_PROJECT_FILE_NAME,
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectFileName,
  type T3ProjectFile,
} from "@t3tools/contracts";
import { parseT3ProjectFile, pickProjectFileRead } from "@t3tools/shared/t3ProjectFile";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

async function readProjectFileByName(
  environmentId: EnvironmentId,
  workspaceRoot: string,
  name: ProjectFileName,
) {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, name),
    { reportDefect: false, reportFailure: false },
  );
  return resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    name,
    result._tag === "Success" ? result.value : null,
  );
}

export async function readT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<T3ProjectFile | null> {
  const [gs, t3] = await Promise.all([
    readProjectFileByName(environmentId, workspaceRoot, GS_PROJECT_FILE_NAME),
    readProjectFileByName(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME),
  ]);
  const data = pickProjectFileRead({ [GS_PROJECT_FILE_NAME]: gs, [T3_PROJECT_FILE_NAME]: t3 });
  if (data === null || data.truncated) return null;
  return parseT3ProjectFile(data.contents);
}
