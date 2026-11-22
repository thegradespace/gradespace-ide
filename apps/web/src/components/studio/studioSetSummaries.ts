import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { useFilesystemReadAccess } from "~/state/filesystem";
import { revisionedQuery } from "~/state/revisionedQuery";

import { getProjectFileQueryAtom } from "../files/projectFilesQueryState";
import { parseStudioManifest, STUDIO_MANIFEST_NAME, type StudioSetSummary } from "./studioManifest";

interface SummariesKey {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly paths: ReadonlyArray<string>;
  readonly revision: string;
}

// Each set's studio.json is the same query StudioSet reads, so opening a set costs nothing more.
const summariesAtom = Atom.family((key: string) => {
  const { environmentId, cwd, paths, revision } = JSON.parse(key) as SummariesKey;
  return Atom.make((get): ReadonlyArray<StudioSetSummary> =>
    paths.map((path) => {
      const query = getProjectFileQueryAtom(environmentId, cwd, `${path}/${STUDIO_MANIFEST_NAME}`);
      const data = AsyncResult.getOrElse(get(revisionedQuery(query, revision)), () => null);
      const manifest = data === null ? null : parseStudioManifest(data.contents);
      return { path, title: manifest?.title ?? null, archived: manifest?.archived === true };
    }),
  );
});

/** Titles and archived flags for the set list, in the order of `paths`. */
export function useStudioSetSummaries(
  environmentId: EnvironmentId,
  cwd: string,
  paths: ReadonlyArray<string>,
  revision: string,
): ReadonlyArray<StudioSetSummary> {
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const key: SummariesKey = {
    environmentId,
    cwd,
    paths: canReadFiles ? paths : [],
    revision,
  };
  return useAtomValue(summariesAtom(JSON.stringify(key)));
}
