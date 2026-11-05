import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { LayoutGrid } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useRightPanelStore } from "~/rightPanelStore";

import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { parseStudioManifest, STUDIO_MANIFEST_NAME } from "./studioManifest";
import type { StudioTurnSet } from "./studioTurnSets.logic";

function StudioTurnCard(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef;
  readonly set: StudioTurnSet;
}) {
  const { set } = props;
  // Mounted only while its row is on screen, so offscreen cards read nothing.
  const file = useProjectFileQuery(
    props.environmentId,
    props.cwd ?? "",
    `${set.setPath}/${STUDIO_MANIFEST_NAME}`,
    props.cwd !== undefined,
    set.revision,
  );
  const manifest = file.data === null ? null : parseStudioManifest(file.data.contents);
  const recommended =
    manifest?.variants.find((variant) => variant.id === manifest.recommended) ?? null;
  const details =
    manifest === null
      ? null
      : [
          `${manifest.variants.length} ${manifest.variants.length === 1 ? "option" : "options"}`,
          recommended === null ? null : `${recommended.id} recommended`,
          manifest.picked === undefined ? null : `${manifest.picked} picked`,
        ]
          .filter((part) => part !== null)
          .join(" · ");
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-sm">{manifest?.title ?? set.name}</span>
        <span className="truncate text-muted-foreground text-xs">
          {details === null ? "Studio set" : `Studio · ${details}`}
        </span>
      </div>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => useRightPanelStore.getState().openStudio(props.threadRef, set.setPath)}
      >
        Open in Studio
      </Button>
    </div>
  );
}

export function StudioTurnCards(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef;
  readonly sets: ReadonlyArray<StudioTurnSet>;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {props.sets.map((set) => (
        <StudioTurnCard
          key={set.setPath}
          environmentId={props.environmentId}
          cwd={props.cwd}
          threadRef={props.threadRef}
          set={set}
        />
      ))}
    </div>
  );
}
