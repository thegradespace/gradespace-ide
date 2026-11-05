import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { StudioShareEntry } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useState } from "react";
import { useNowMinute } from "../../hooks/useNowMinute";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";

type ScopedEnvironment = ReturnType<typeof useSettingsScope>["connectedEnvironments"][number];

const formatDay = (isoDate: string) =>
  new Date(isoDate).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function shareStatus(share: StudioShareEntry, nowMs: number) {
  if (share.revoked) return "Turned off";
  if (share.expiresAt === null) return "Never expires";
  return Date.parse(share.expiresAt) <= nowMs
    ? `Expired ${formatDay(share.expiresAt)}`
    : `Expires ${formatDay(share.expiresAt)}`;
}

const failureMessage = (cause: unknown) =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : "Something went wrong.";

function EnvironmentShareLinks({
  environment,
  label,
}: {
  environment: ScopedEnvironment;
  label: string | null;
}) {
  const { environmentId } = environment;
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const statusQuery = serverEnvironment.studioShareStatus({ environmentId, input: {} });
  const listQuery = serverEnvironment.studioShareList({ environmentId, input: {} });
  const status = useAtomValue(statusQuery);
  const list = useAtomValue(listQuery);
  const refreshStatus = useAtomRefresh(statusQuery);
  const refreshList = useAtomRefresh(listQuery);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | "revoke" | null>(null);
  const [confirming, setConfirming] = useState<StudioShareEntry | null>(null);
  const setShareToken = useAtomCommand(serverEnvironment.setStudioShareToken, {
    reportFailure: false,
  });
  const revokeShare = useAtomCommand(serverEnvironment.revokeStudioShare, {
    reportFailure: false,
  });
  const allowed = useAtomValue(serverEnvironment.setStudioShareToken.permissionAtom(environmentId));
  const configured = status._tag === "Success" && status.value.configured;
  const suffix = label === null ? "" : ` on ${label}`;

  const run = async <A,>(
    kind: NonNullable<typeof pending>,
    start: () => Promise<AtomCommandResult<A, unknown>>,
    success: string,
    failure: string,
  ) => {
    if (pending !== null) return false;
    setPending(kind);
    const result = await start().finally(() => setPending(null));
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: success });
      refreshStatus();
      refreshList();
      return true;
    }
    if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: `${failure}${suffix}`,
        description: failureMessage(squashAtomCommandFailure(result)),
      });
    }
    return false;
  };

  const saveToken = async () => {
    const saved = await run(
      "save",
      () => setShareToken({ environmentId, input: { token: token.trim() } }),
      "Share key saved",
      "Could not save the share key",
    );
    if (saved) {
      setToken("");
      setEditing(false);
    }
  };

  const copyLink = (share: StudioShareEntry) =>
    writeTextToClipboard(share.url, "share link").then(
      () => toastManager.add({ type: "success", title: "Link copied" }),
      () => toastManager.add({ type: "error", title: "Could not copy the link" }),
    );

  const confirmRevoke = () => {
    const share = confirming;
    setConfirming(null);
    if (share === null) return;
    void run(
      "revoke",
      () => revokeShare({ environmentId, input: { id: share.id } }),
      "Link turned off",
      "Could not turn off the link",
    );
  };

  const showInput = status._tag === "Success" && (!status.value.configured || editing);
  const shares = list._tag === "Success" ? list.value.shares : [];

  return (
    <>
      <SettingsRow
        {...searchableSetting("share-links")}
        title={label === null ? "Share key" : `Share key on ${label}`}
        description={
          <>
            <span className="block">
              Share a Studio design with anyone using a private link. Links expire, and you can turn
              them off here.
            </span>
            {status._tag !== "Success" && (
              <span className="block">
                {status.waiting ? "Loading…" : "Could not load the share key."}
              </span>
            )}
          </>
        }
        control={
          showInput ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (token.trim().length > 0) void saveToken();
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                aria-label="Share key"
                placeholder="Paste your share key"
                className="w-56"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!allowed || pending !== null || token.trim().length === 0}
              >
                {pending === "save" && <Spinner size="sm" />}
                Save
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setToken("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </form>
          ) : configured ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Key saved</span>
              <Button
                variant="outline"
                size="sm"
                disabled={!allowed || pending !== null}
                onClick={() => setEditing(true)}
              >
                Replace
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!allowed || pending !== null}
                onClick={() =>
                  void run(
                    "remove",
                    () => setShareToken({ environmentId, input: { token: null } }),
                    "Share key removed",
                    "Could not remove the share key",
                  )
                }
              >
                {pending === "remove" && <Spinner size="sm" />}
                Remove
              </Button>
            </div>
          ) : undefined
        }
      />
      {configured && list._tag === "Failure" && (
        <SettingsRow
          title="Could not load your links"
          description={failureMessage(Cause.squash(list.cause))}
          control={
            <Button variant="outline" size="sm" onClick={refreshList}>
              Try again
            </Button>
          }
        />
      )}
      {configured && list._tag === "Success" && shares.length === 0 && (
        <SettingsRow
          title="No links yet"
          description="Share a design from Studio to see it here."
        />
      )}
      {shares.map((share) => {
        const active =
          !share.revoked && !(share.expiresAt !== null && Date.parse(share.expiresAt) <= nowMs);
        return (
          <SettingsRow
            key={share.id}
            title={share.title.length > 0 ? share.title : share.fileName}
            description={`Shared ${formatRelativeTimeLabel(share.createdAt, nowMs)}. ${shareStatus(share, nowMs)}.`}
            control={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!active}
                  onClick={() => void copyLink(share)}
                >
                  Copy link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!allowed || !active || pending !== null}
                  onClick={() => setConfirming(share)}
                >
                  Stop sharing
                </Button>
              </div>
            }
          />
        );
      })}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop sharing this design?</AlertDialogTitle>
            <AlertDialogDescription>
              The link will stop working for everyone who has it. You can share the design again
              later with a new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep sharing</AlertDialogClose>
            <Button onClick={confirmRevoke}>Stop sharing</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

export function ShareLinksSection() {
  const { scope, connectedEnvironments } = useSettingsScope();
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.studioShare === true,
  );
  if (scope.kind === "project" || scope.kind === "checkout" || supported.length === 0) return null;
  return (
    <SettingsSection id="share-links-section" title="Share links">
      {supported.map((environment) => (
        <EnvironmentShareLinks
          key={environment.environmentId}
          environment={environment}
          label={
            supported.length > 1
              ? settingsScopeEnvironmentLabel(environment, connectedEnvironments)
              : null
          }
        />
      ))}
    </SettingsSection>
  );
}
