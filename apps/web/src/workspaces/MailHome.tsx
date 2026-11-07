import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  emailConnectGuide,
  emailProviderRows,
  type EmailProviderRow,
  isMailQuickJobPrompt,
  MAIL_QUICK_JOBS,
  MAIL_SAFETY_NOTE,
  MAIL_SKILL,
  mailQuickJobPrompt,
  type MailQuickJob,
  preferredEmailProvider,
} from "@t3tools/client-runtime/mailHome";
import type {
  EmailConnectionsReport,
  EnvironmentId,
  ProviderInstanceId,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";
import type { ProviderDriverKind } from "@t3tools/contracts";
import {
  CalendarClockIcon,
  InboxIcon,
  MailCheckIcon,
  ReplyIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { toastManager } from "../components/ui/toast";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useClientSettings } from "../hooks/useSettings";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";
import { getDefaultServerModel } from "../providerModels";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useThreadWorkspaces } from "./workspaceStore";
import {
  isSkillInstalled,
  isWorkspaceSeedPrompt,
  resolveThreadWorkspace,
} from "./workspaces.logic";

const JOB_ICONS: Record<MailQuickJob["id"], typeof InboxIcon> = {
  triage: InboxIcon,
  reply: ReplyIcon,
  meeting: CalendarClockIcon,
  followUps: MailCheckIcon,
};

const STATE_TEXT: Record<EmailProviderRow["state"], string> = {
  connected: "Connected",
  notConnected: "Not connected",
  unknown: "Unknown",
};

interface MailHomeProps {
  threadId: string;
  environmentId: EnvironmentId;
  composerDraftTarget: ScopedThreadRef | DraftId;
  activeProviderInstanceId: ProviderInstanceId | null;
  onStarted: () => void;
}

/** Mail's start surface under a new chat's composer: email status per provider and quick jobs. */
export function MailHome(props: MailHomeProps) {
  const railEnabled = useClientSettings((settings) => settings.workspaceRailEnabled);
  const threadWorkspaces = useThreadWorkspaces();
  const serverConfig = useAtomValue(environmentServerConfigsAtom).get(props.environmentId);
  if (!railEnabled || resolveThreadWorkspace({ id: props.threadId }, threadWorkspaces) !== "mail") {
    return null;
  }
  const providers = serverConfig?.providers ?? [];
  // Older servers can't report it; their rows stay unknown and Check has nothing to ask.
  if (serverConfig?.environment.capabilities.emailConnections !== true) {
    return <MailHomeBody {...props} providers={providers} report={null} checking={false} />;
  }
  return <MailHomeWithReport {...props} providers={providers} />;
}

function MailHomeWithReport(props: MailHomeProps & { providers: ReadonlyArray<ServerProvider> }) {
  const query = serverEnvironment.emailConnectionsStatus({
    environmentId: props.environmentId,
    input: {},
  });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const report = result._tag === "Success" ? result.value : null;
  return <MailHomeBody {...props} report={report} checking={result.waiting} onCheck={refresh} />;
}

function MailHomeBody(
  props: MailHomeProps & {
    providers: ReadonlyArray<ServerProvider>;
    report: EmailConnectionsReport | null;
    checking: boolean;
    onCheck?: () => void;
  },
) {
  const [guideFor, setGuideFor] = useState<ProviderDriverKind | null>(null);
  const rows = emailProviderRows(props.providers, props.report);

  const startJob = (job: MailQuickJob) => {
    const drafts = useComposerDraftStore.getState();
    const prompt = drafts.getComposerDraft(props.composerDraftTarget)?.prompt ?? "";
    if (prompt.trim() !== "" && !isWorkspaceSeedPrompt(prompt) && !isMailQuickJobPrompt(prompt)) {
      toastManager.add({
        type: "info",
        title: "Your message is still here",
        description: "Clear the message box to start a quick job instead.",
      });
      return;
    }
    drafts.setPrompt(
      props.composerDraftTarget,
      mailQuickJobPrompt(job, isSkillInstalled(MAIL_SKILL, props.providers)),
    );
    const preferred = preferredEmailProvider(rows, props.activeProviderInstanceId);
    const provider = props.providers.find((candidate) => candidate.instanceId === preferred);
    if (provider) {
      const model =
        provider.models.find((candidate) => candidate.isDefault && !candidate.isCustom)?.slug ??
        provider.models.find((candidate) => !candidate.isCustom)?.slug ??
        getDefaultServerModel(props.providers, provider.driver);
      drafts.setModelSelection(
        props.composerDraftTarget,
        { instanceId: provider.instanceId, model },
        { explicit: true, replaceOptions: true },
      );
    }
    props.onStarted();
  };

  const guide = guideFor === null ? null : emailConnectGuide(guideFor);
  return (
    <section aria-label="Mail home" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col rounded-xl border border-border bg-card/70 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">Your email</h2>
            <Button
              type="button"
              variant="ghost-muted"
              size="xs"
              disabled={props.onCheck === undefined || props.checking}
              aria-label="Check email connections again"
              onClick={props.onCheck}
            >
              {props.checking ? "Checking…" : "Check"}
            </Button>
          </div>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li key={row.instanceId} className="flex min-h-8 items-center gap-2 text-sm">
                <StatusDot state={row.state} />
                <span className="min-w-0 truncate text-foreground">{row.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {STATE_TEXT[row.state]}
                  {row.connectors.length > 0 ? ` · ${row.connectors.join(", ")}` : ""}
                </span>
                {row.state === "connected" ? null : (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    aria-label={`How to connect email to ${row.label}`}
                    onClick={() => setGuideFor(row.driver)}
                  >
                    How to connect
                  </Button>
                )}
              </li>
            ))}
            {rows.length === 0 ? (
              <li className="py-1 text-xs text-muted-foreground">
                Set up Codex or Claude on this environment to use Mail.
              </li>
            ) : null}
            <li className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
              <StatusDot state={null} />
              <span>Outlook · coming later</span>
            </li>
          </ul>
        </div>
        {/* First on phones, where the space under a centered composer is short. */}
        <div className="flex flex-col rounded-xl border border-border bg-card/70 p-3 max-sm:order-first">
          <h2 className="mb-2 text-sm font-medium text-foreground">Start</h2>
          <div className="grid grid-cols-2 gap-2">
            {MAIL_QUICK_JOBS.map((job) => {
              const Icon = JOB_ICONS[job.id];
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => startJob(job)}
                  aria-label={`${job.title}: ${job.detail}`}
                  className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-border p-2.5 text-left outline-hidden ring-ring hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <Icon aria-hidden className="size-4 text-muted-foreground" />
                  <span className="text-sm leading-tight font-medium text-foreground">
                    {job.title}
                  </span>
                  <span className="text-xs leading-tight text-muted-foreground">{job.detail}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheckIcon aria-hidden className="size-3.5 shrink-0" />
        {MAIL_SAFETY_NOTE}
      </p>
      <Dialog open={guide !== null} onOpenChange={(open) => (open ? null : setGuideFor(null))}>
        {guide ? (
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>{guide.title}</DialogTitle>
              <DialogDescription>
                The agent drafts email through its own connection, so connect it there once.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground">
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGuideFor(null)}>
                Done
              </Button>
              {guide.link ? (
                <Button
                  type="button"
                  onClick={() => {
                    const url = guide.link?.url;
                    if (url === undefined) return;
                    const api = readLocalApi();
                    if (api)
                      void api.shell.openExternal(url).catch(() => window.open(url, "_blank"));
                    else window.open(url, "_blank", "noopener,noreferrer");
                  }}
                >
                  {guide.link.label}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogPopup>
        ) : null}
      </Dialog>
    </section>
  );
}

function StatusDot({ state }: { state: EmailProviderRow["state"] | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        state === "connected"
          ? "bg-success"
          : state === "notConnected"
            ? "bg-destructive"
            : state === "unknown"
              ? "bg-muted-foreground/60"
              : "bg-muted-foreground/25",
      )}
    />
  );
}
