import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  STUDIO_SHARE_FILE_PATTERN,
  type StudioShareEntry,
  type StudioShareExpiryDays,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Share2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { useServerConfigs } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { showToast } from "./StudioVariantPreview";
import type { StudioVariant } from "./studioManifest";

const EXPIRY_CHOICES: ReadonlyArray<{
  readonly days: StudioShareExpiryDays;
  readonly label: string;
}> = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "Never" },
];

/** Plain markup, not a Base UI popover: those portal into the main window, which a popped-out window is not. */
function SharePanel(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly defaultTitle: string;
  readonly native: boolean;
  readonly onClose: () => void;
}) {
  const { environmentId } = props;
  const navigate = useNavigate();
  const statusQuery = serverEnvironment.studioShareStatus({ environmentId, input: {} });
  const status = useAtomValue(statusQuery);
  const refreshStatus = useAtomRefresh(statusQuery);
  const allowed = useAtomValue(serverEnvironment.createStudioShare.permissionAtom(environmentId));
  const createShare = useAtomCommand(serverEnvironment.createStudioShare, {
    reportFailure: false,
  });
  const [title, setTitle] = useState(props.defaultTitle);
  const [days, setDays] = useState<StudioShareExpiryDays>(7);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<StudioShareEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setCreating(true);
    setError(null);
    const result = await createShare({
      environmentId,
      input: {
        cwd: props.cwd,
        relativePath: props.relativePath,
        title: title.trim(),
        expiresInDays: days,
      },
    }).finally(() => setCreating(false));
    if (result._tag === "Success") {
      setCreated(result.value);
      setCopied(false);
    } else if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not create the link.");
    }
  };

  // The popup has its own clipboard and focus, so the copy runs against the window that owns the button.
  const copy = async (link: string) => {
    const owner = linkRef.current?.ownerDocument;
    try {
      await (owner?.defaultView ?? window).navigator.clipboard.writeText(link);
    } catch {
      linkRef.current?.select();
      if (owner?.execCommand("copy") !== true) {
        setError("Could not copy the link. Select it and copy it yourself.");
        return;
      }
    }
    setCopied(true);
    if (!props.native) showToast("success", "Link copied");
  };

  const openLink = (link: string) => {
    const owner = linkRef.current?.ownerDocument.defaultView ?? window;
    owner.open(link, "_blank", "noopener,noreferrer");
  };

  const body = () => {
    if (status._tag !== "Success") {
      return status.waiting ? (
        <Spinner size="sm" />
      ) : (
        <div className="flex flex-col items-start gap-2 text-xs">
          <span>Could not check sharing.</span>
          <Button type="button" size="xs" variant="outline" onClick={refreshStatus}>
            Try again
          </Button>
        </div>
      );
    }
    if (!status.value.configured) {
      return (
        <div className="flex flex-col items-start gap-2 text-xs">
          <span>Add your share key in Settings to share designs.</span>
          <Button
            type="button"
            size="xs"
            onClick={() => {
              props.onClose();
              void navigate({ to: "/settings/maintenance", hash: "share-links-section" });
            }}
          >
            Open Settings
          </Button>
        </div>
      );
    }
    if (created !== null) {
      return (
        <div className="flex flex-col gap-2">
          <Input
            ref={linkRef}
            nativeInput
            readOnly
            size="compact"
            aria-label="Share link"
            value={created.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex items-center gap-1">
            <Button type="button" size="xs" onClick={() => void copy(created.url)}>
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => openLink(created.url)}>
              Open
            </Button>
            <div className="min-w-0 flex-1" />
            <Button type="button" size="xs" variant="ghost" onClick={() => setCreated(null)}>
              Share again
            </Button>
          </div>
          <span className="text-muted-foreground text-xs">
            Anyone with this link can see this version.{" "}
            {created.expiresAt === null
              ? "It never expires."
              : `It stops working on ${new Date(created.expiresAt).toLocaleDateString()}.`}{" "}
            You can turn it off in Settings.
          </span>
        </div>
      );
    }
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!creating && allowed) void create();
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          Title
          <Input
            nativeInput
            size="compact"
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div role="group" aria-label="Link expires after" className="flex flex-col gap-1 text-xs">
          Link expires after
          <div className="flex gap-1">
            {EXPIRY_CHOICES.map((choice) => (
              <Button
                key={choice.days}
                type="button"
                size="xs"
                variant={choice.days === days ? "secondary" : "ghost"}
                aria-pressed={choice.days === days}
                onClick={() => setDays(choice.days)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        </div>
        <Button type="submit" size="xs" disabled={creating || !allowed}>
          {creating && <Spinner size="sm" />}
          {creating ? "Creating…" : "Create link"}
        </Button>
        {!allowed && (
          <span className="text-muted-foreground text-xs">
            You don't have permission to share from this environment.
          </span>
        )}
      </form>
    );
  };

  return (
    <div
      role="dialog"
      aria-label="Share this design"
      className="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      <div className="font-medium text-xs">Share this design</div>
      {body()}
      {error === null ? null : (
        <span role="alert" className="text-destructive-foreground text-xs">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Shares the file being viewed, so an earlier version shares that version. The caller passes the
 * variant as shown, with `file` already switched to the viewed version.
 */
export function StudioShareButton(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly setPath: string;
  readonly variant: StudioVariant;
  /** Names the option when more than one toolbar has a Share button. */
  readonly optionLabel?: string | undefined;
  readonly native: boolean;
}) {
  const supported =
    useServerConfigs().get(props.environmentId)?.environment.capabilities.studioShare === true;
  const [open, setOpen] = useState(false);
  if (!supported) return null;
  const shareable = STUDIO_SHARE_FILE_PATTERN.test(props.variant.file);
  const label = props.optionLabel === undefined ? "Share" : `Share option ${props.optionLabel}`;
  return (
    <div className="relative shrink-0">
      <Button
        type="button"
        size="xs"
        variant={open ? "secondary" : "outline"}
        aria-label={label}
        aria-expanded={open}
        title={shareable ? label : "This kind of file can't be shared"}
        disabled={!shareable}
        onClick={() => setOpen((current) => !current)}
      >
        <Share2 className="size-3.5" />
        Share
      </Button>
      {open && shareable ? (
        <SharePanel
          // A new file or option starts a fresh form, and drops a link made for the previous one.
          key={`${props.setPath}/${props.variant.file}`}
          environmentId={props.environmentId}
          cwd={props.cwd}
          relativePath={`${props.setPath}/${props.variant.file}`}
          defaultTitle={`${props.variant.id}: ${props.variant.title}`}
          native={props.native}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
