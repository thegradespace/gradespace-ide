import { DATED_BACKUP_FILE_PATTERN, type BackupEntry, type BackupStatus } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { formatBytes } from "../../lib/formatBytes";
import { useNowMinute } from "../../hooks/useNowMinute";
import { serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { isHostedByThisApp } from "../sidebar/useUpdateEverything";
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

function backupLabel(entry: BackupEntry) {
  const dated = DATED_BACKUP_FILE_PATTERN.test(entry.fileName);
  if (dated) {
    // The file name carries the local calendar day it was made for.
    const [year, month, day] = entry.fileName.slice(8, 18).split("-").map(Number);
    return formatDay(new Date(year!, month! - 1, day!).toISOString());
  }
  if (entry.fileName.startsWith("statev2-before-restore-")) {
    return `Saved before a restore, ${new Date(entry.createdAt).toLocaleString()}`;
  }
  return entry.fileName.replace(/^statev2-/, "").replace(/\.sqlite$/, "");
}

function EnvironmentBackups({
  environment,
  label,
}: {
  environment: ScopedEnvironment;
  label: string | null;
}) {
  const { environmentId } = environment;
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const query = useAtomValue(serverEnvironment.backups({ environmentId, input: {} }));
  const [latest, setLatest] = useState<BackupStatus | null>(null);
  const [pending, setPending] = useState<"create" | "restore" | "cancel" | null>(null);
  const [confirming, setConfirming] = useState<BackupEntry | null>(null);
  const createBackup = useAtomCommand(serverEnvironment.createBackup, { reportFailure: false });
  const restoreBackup = useAtomCommand(serverEnvironment.restoreBackup, { reportFailure: false });
  const cancelRestore = useAtomCommand(serverEnvironment.cancelBackupRestore, {
    reportFailure: false,
  });
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.createBackup.permissionAtom(environmentId));
  const status = latest ?? (query._tag === "Success" ? query.value : null);
  const hosted = isHostedByThisApp(environment);
  const canOpenFolder =
    hosted && environment.serverConfig?.availableEditors.includes("file-manager") === true;
  const canRelaunch = hosted && window.desktopBridge?.relaunchApp !== undefined;
  const suffix = label === null ? "" : ` on ${label}`;

  const run = async (
    kind: NonNullable<typeof pending>,
    start: () => Promise<AtomCommandResult<BackupStatus, unknown>>,
    success: string | null,
    failure: string,
  ) => {
    if (pending !== null) return;
    setPending(kind);
    const result = await start().finally(() => setPending(null));
    if (result._tag === "Success") {
      setLatest(result.value);
      if (success !== null) toastManager.add({ type: "success", title: success });
    } else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: `${failure}${suffix}`,
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };

  const confirmRestore = () => {
    const entry = confirming;
    setConfirming(null);
    if (entry === null) return;
    void run(
      "restore",
      () => restoreBackup({ environmentId, input: { fileName: entry.fileName } }),
      null,
      "Could not restore the backup",
    );
  };

  const pendingEntry = status?.backups.find((entry) => entry.fileName === status.pendingRestore);
  const lastBackup =
    status?.lastBackupAt == null
      ? "No backup yet."
      : `Last backup ${formatRelativeTimeLabel(status.lastBackupAt, nowMs)}.`;

  return (
    <>
      <SettingsRow
        {...searchableSetting("storage-backups")}
        title={label === null ? "Daily backups" : `Daily backups on ${label}`}
        description={
          <>
            <span className="block">
              Gradespace backs up your projects and chats every day and keeps the last 7.
            </span>
            <span className="block">
              {status === null
                ? query.waiting
                  ? "Loading backups…"
                  : "Could not load backups."
                : lastBackup}
            </span>
          </>
        }
        status={status?.lastError ?? undefined}
        control={
          <div className="flex items-center gap-2">
            {canOpenFolder && status !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void openInEditor({
                    environmentId,
                    input: { cwd: status.directory, editor: "file-manager" },
                  })
                }
              >
                Open backups folder
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed || pending !== null}
              onClick={() =>
                void run(
                  "create",
                  () => createBackup({ environmentId, input: {} }),
                  "Backup saved",
                  "Could not back up",
                )
              }
            >
              {pending === "create" && <Spinner size="sm" />}
              {pending === "create" ? "Backing up…" : "Back up now"}
            </Button>
          </div>
        }
      />
      {status?.pendingRestore != null && (
        <SettingsRow
          title="Restart to finish restoring"
          description={`Gradespace will replace your chats with the backup from ${
            pendingEntry ? backupLabel(pendingEntry) : status.pendingRestore
          } the next time it starts. Your current chats were saved first.${
            canRelaunch ? "" : " Quit and reopen Gradespace to finish."
          }`}
          control={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() =>
                  void run(
                    "cancel",
                    () => cancelRestore({ environmentId, input: {} }),
                    "Restore cancelled",
                    "Could not cancel the restore",
                  )
                }
              >
                Cancel restore
              </Button>
              {canRelaunch && (
                <Button size="sm" onClick={() => void window.desktopBridge?.relaunchApp()}>
                  Restart now
                </Button>
              )}
            </div>
          }
        />
      )}
      {status?.backups.map((entry) => (
        <SettingsRow
          key={entry.fileName}
          title={backupLabel(entry)}
          description={formatBytes(entry.sizeBytes)}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed || pending !== null}
              onClick={() => setConfirming(entry)}
            >
              Restore…
            </Button>
          }
        />
      ))}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current chats will be saved first, then replaced by the backup from{" "}
              {confirming === null ? "" : backupLabel(confirming)} when Gradespace restarts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button onClick={confirmRestore}>Restore</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

export function BackupsSection() {
  const { scope, connectedEnvironments } = useSettingsScope();
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.backups === true,
  );
  if (scope.kind === "project" || scope.kind === "checkout" || supported.length === 0) return null;
  return (
    <SettingsSection id="backups-section" title="Backups">
      {supported.map((environment) => (
        <EnvironmentBackups
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
