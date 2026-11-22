import type { EnvironmentId } from "@t3tools/contracts";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useSyncExternalStore } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";

import { getProjectFileQueryAtom, useProjectFileQuery } from "../files/projectFilesQueryState";
import type { StudioCheckIssue } from "./studioChecks";
import { checkStudioHtml, type StudioCheckFiles } from "./studioChecksFrame";
import { type StudioVariant, studioVariantKind } from "./studioManifest";
import { contentRevision, type StudioContext } from "./StudioVariantPreview";

export type StudioCheckState =
  | { readonly status: "pending" }
  | { readonly status: "done"; readonly issues: readonly StudioCheckIssue[] }
  | { readonly status: "failed" };

const PENDING: StudioCheckState = { status: "pending" };
const MAX_RESULTS = 200;

// One result per file version, shared by the card and the open view, kept for the session.
const results = new Map<string, StudioCheckState>();
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function settle(key: string, state: StudioCheckState) {
  results.set(key, state);
  if (results.size > MAX_RESULTS) results.delete(results.keys().next().value!);
  for (const listener of listeners) listener();
}

const idle = () =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve());
    else setTimeout(resolve, 0);
  });

function projectFiles(environmentId: EnvironmentId, cwd: string): StudioCheckFiles {
  const listings = new Map<string, Promise<ReadonlySet<string> | null>>();
  const list = (directoryPath: string) => {
    let listing = listings.get(directoryPath);
    if (listing === undefined) {
      listing = executeAtomQuery(
        appAtomRegistry,
        projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath } }),
        { reportFailure: false, reportDefect: false },
      ).then((result) =>
        result._tag === "Success" ? new Set(result.value.entries.map((entry) => entry.path)) : null,
      );
      listings.set(directoryPath, listing);
    }
    return listing;
  };
  return {
    readText: async (path) => {
      const result = await executeAtomQuery(
        appAtomRegistry,
        getProjectFileQueryAtom(environmentId, cwd, path),
        { reportFailure: false, reportDefect: false },
      );
      return result._tag === "Success" && !result.value.truncated ? result.value.contents : null;
    },
    // Walks down from the project root one listing at a time, so a missing folder is missing too.
    exists: async (path) => {
      const segments = path.split("/");
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const parent = segments.slice(0, depth - 1).join("/");
        const entries = await list(parent);
        if (entries === null) return true;
        if (!entries.has(segments.slice(0, depth).join("/"))) return false;
      }
      return true;
    },
  };
}

/**
 * Checks for an HTML option, run once per file version in idle time, one page at a time, so
 * they never hold up the previews. Null for options that are not HTML.
 */
export function useStudioChecks(
  context: StudioContext & { readonly setPath: string },
  variant: StudioVariant,
): StudioCheckState | null {
  const html = studioVariantKind(variant.file) === "html";
  const relativePath = `${context.setPath}/${variant.file}`;
  const file = useProjectFileQuery(
    context.environmentId,
    context.cwd,
    relativePath,
    html,
    context.readRevision,
  );
  const contents = html && file.data !== null && !file.data.truncated ? file.data.contents : null;
  const key = contents === null ? null : `${relativePath}\n${contentRevision(contents)}`;
  const state = useSyncExternalStore(subscribe, () => (key === null ? null : results.get(key)));
  const { environmentId, cwd } = context;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the checks load the design in a hidden frame outside React
  useEffect(() => {
    if (key === null || contents === null || results.has(key)) return;
    settle(key, PENDING);
    const baseDir = relativePath.split("/").slice(0, -1).join("/");
    queue = queue.then(async () => {
      await idle();
      try {
        const issues = await checkStudioHtml(contents, baseDir, projectFiles(environmentId, cwd));
        settle(key, { status: "done", issues });
      } catch {
        settle(key, { status: "failed" });
      }
    });
  }, [key, contents, relativePath, environmentId, cwd]);
  if (!html) return null;
  return state ?? PENDING;
}
