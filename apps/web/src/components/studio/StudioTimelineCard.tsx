import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type DesktopVideoEditor } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";

import { useAssetUrlRefresh } from "~/assets/assetUrls";
import { Button } from "~/components/ui/button";

import { useRemoteOpenResolution } from "../../remoteOpen";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { canUseMarkdownFileShellActions } from "../chat/MarkdownFileLink.logic";
import { workspaceAssetResource } from "../files/filePreviewMode";
import type { StudioTimeline, StudioTimelineFormat, StudioVariant } from "./studioManifest";
import { type StudioContext, showToast } from "./StudioVariantPreview";

const EDITORS: ReadonlyArray<{
  readonly editor: DesktopVideoEditor;
  readonly label: string;
  readonly format: StudioTimelineFormat;
}> = [
  { editor: "resolve", label: "DaVinci Resolve", format: "fcpxml" },
  { editor: "premiere", label: "Premiere Pro", format: "xml" },
  { editor: "final-cut", label: "Final Cut Pro", format: "fcpxml" },
];

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : undefined);

/**
 * How this client reaches a set file: the desktop app opens it in an editor or reveals it when
 * the environment is this computer, the server reveals it for a local browser, and anything
 * remote downloads it.
 */
function useTimelineReach(context: StudioContext) {
  const config = useAtomValue(serverEnvironment.configValueAtom(context.environmentId));
  const canOperateHost = useEnvironmentScope(context.environmentId, AuthOrchestrationOperateScope);
  const remoteOpen = useRemoteOpenResolution(context.environmentId);
  const local =
    canOperateHost &&
    canUseMarkdownFileShellActions(
      context.environmentId,
      remoteOpen.state.mode,
      remoteOpen.isResolved,
    );
  const canReveal =
    local &&
    config?.shellRevealInFileManager === true &&
    config.availableEditors.includes("file-manager");
  const bridge = local ? window.desktopBridge : undefined;
  const listEditors = bridge?.listVideoEditors;
  const [installed, setInstalled] = useState<readonly DesktopVideoEditor[] | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the desktop app which editors are installed
  useEffect(() => {
    if (listEditors === undefined) return;
    let current = true;
    void listEditors()
      .then((editors) => current && setInstalled(editors))
      .catch(() => current && setInstalled([]));
    return () => {
      current = false;
    };
  }, [listEditors]);
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const reveal = async (absolutePath: string) => {
    const result = await openInEditor({
      environmentId: context.environmentId,
      input: { cwd: absolutePath, editor: "file-manager", reveal: true },
    });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    throw squashAtomCommandFailure(result);
  };
  return {
    canReveal,
    installed: installed ?? [],
    openWith: bridge?.openInVideoEditor,
    reveal,
  };
}

type TimelineReach = ReturnType<typeof useTimelineReach>;

/** Reveals the file where the client can, otherwise downloads it under its own name. */
function useTimelineFile(context: StudioContext, reach: TimelineReach, absolutePath: string) {
  const resource = workspaceAssetResource({
    kind: "media-file",
    threadRef: context.threadRef,
    draft: context.draft,
    workspaceRoot: context.cwd,
    absolutePath,
  });
  const refreshUrl = useAssetUrlRefresh(
    context.environmentId,
    resource._tag === "media-file" ? { ...resource, disposition: "attachment" } : resource,
  );
  return async (owner: Document) => {
    if (reach.canReveal) {
      await reach.reveal(absolutePath);
      return;
    }
    const url = await refreshUrl();
    if (!url) throw new Error("Reconnect to the environment and try again.");
    // Desktop sends cross-origin navigations to the browser, so it saves through a blob.
    const href =
      window.desktopBridge === undefined
        ? url
        : URL.createObjectURL(await (await fetch(url)).blob());
    const anchor = owner.createElement("a");
    anchor.href = href;
    anchor.download = absolutePath.split(/[\\/]/).at(-1) ?? "timeline";
    anchor.click();
    if (href !== url) setTimeout(() => URL.revokeObjectURL(href), 30_000);
  };
}

function EditorButton(
  props: StudioContext & {
    readonly reach: TimelineReach;
    readonly editor: (typeof EDITORS)[number];
    readonly absolutePath: string;
    readonly primary: boolean;
  },
) {
  const { reach, editor, absolutePath } = props;
  const fallback = useTimelineFile(props, reach, absolutePath);
  const installed = reach.installed.includes(editor.editor);
  const fileName = absolutePath.split(/[\\/]/).at(-1) ?? "";
  const action = installed
    ? `Open ${fileName} in ${editor.label}`
    : reach.canReveal
      ? `Show ${fileName} to open in ${editor.label}`
      : `Download ${fileName} for ${editor.label}`;
  const run = (owner: Document) => {
    const open =
      installed && reach.openWith !== undefined
        ? reach.openWith({ editor: editor.editor, path: absolutePath })
        : fallback(owner);
    void open.catch((cause: unknown) =>
      showToast("error", `Could not open the timeline in ${editor.label}`, errorText(cause)),
    );
  };
  return (
    <Button
      type="button"
      size="sm"
      variant={props.primary ? "default" : "outline"}
      title={action}
      aria-label={action}
      onClick={(event) => run(event.currentTarget.ownerDocument)}
    >
      {props.primary ? `Open in ${editor.label}` : editor.label}
    </Button>
  );
}

function FileButton(
  props: StudioContext & {
    readonly reach: TimelineReach;
    readonly absolutePath: string;
    readonly label: string;
  },
) {
  const save = useTimelineFile(props, props.reach, props.absolutePath);
  const fileName = props.absolutePath.split(/[\\/]/).at(-1) ?? props.label;
  const action = props.reach.canReveal ? `Show ${fileName}` : `Download ${fileName}`;
  return (
    <Button
      type="button"
      size="micro"
      variant="ghost-muted"
      title={action}
      aria-label={action}
      onClick={(event) =>
        void save(event.currentTarget.ownerDocument).catch((cause: unknown) =>
          showToast("error", `Could not get ${fileName}`, errorText(cause)),
        )
      }
    >
      {props.label}
    </Button>
  );
}

/**
 * The rough cut's timeline files, under its preview. Desktop lists only the editors installed
 * here; elsewhere, or when none is found, each button shows or downloads its file instead.
 */
export function StudioTimelineCard(
  props: StudioContext & {
    readonly setPath: string;
    readonly variant: StudioVariant;
    readonly timeline: StudioTimeline;
  },
) {
  const reach = useTimelineReach(props);
  const pathOf = (file: string) => resolvePathLinkTarget(`${props.setPath}/${file}`, props.cwd);
  const offered = EDITORS.filter((entry) => props.timeline[entry.format] !== undefined);
  const installed = offered.filter((entry) => reach.installed.includes(entry.editor));
  const shown = installed.length > 0 ? installed : offered;
  const files = [
    ...(["fcpxml", "xml", "edl"] as const).flatMap((format) => {
      const file = props.timeline[format];
      return file === undefined ? [] : [{ label: `.${format}`, file }];
    }),
    { label: props.variant.file.split("/").at(-1) ?? props.variant.file, file: props.variant.file },
  ];
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t px-3 py-2.5">
      <div className="flex items-center gap-2 font-medium text-sm">
        <Clapperboard className="size-4 text-muted-foreground" />
        Rough cut for your editor
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((entry, index) => (
          <EditorButton
            key={entry.editor}
            {...props}
            reach={reach}
            editor={entry}
            absolutePath={pathOf(props.timeline[entry.format]!)}
            primary={index === 0}
          />
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-0.5 text-muted-foreground text-xs">
          <span className="pe-1">Files:</span>
          {files.map((entry) => (
            <FileButton
              key={entry.file}
              {...props}
              reach={reach}
              absolutePath={pathOf(entry.file)}
              label={entry.label}
            />
          ))}
        </div>
      </div>
      {shown.some((entry) => entry.editor === "resolve") ? (
        <p className="text-muted-foreground text-xs">In Resolve: File → Import → Timeline</p>
      ) : null}
    </div>
  );
}
