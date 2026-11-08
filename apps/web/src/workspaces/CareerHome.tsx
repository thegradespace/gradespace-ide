import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type CareerAction,
  careerHome,
  careerProfileRows,
  careerPrompt,
  type CareerProfileRow,
  closingLabel,
  statementSegments,
} from "@t3tools/client-runtime/career";
import type {
  CareerApplication,
  CareerReport,
  EnvironmentId,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";
import { ShieldCheckIcon } from "lucide-react";
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
import { cn } from "../lib/utils";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useThreadWorkspaces } from "./workspaceStore";
import {
  isSkillInstalled,
  isWorkspaceSeedPrompt,
  resolveThreadWorkspace,
} from "./workspaces.logic";

const JOBS_SKILL = "gs-jobs";
const SAFETY_NOTE =
  "Nothing is submitted without you: the agent fills each form and stops at Submit.";

interface CareerHomeProps {
  threadId: string;
  environmentId: EnvironmentId;
  composerDraftTarget: ScopedThreadRef | DraftId;
  /** Puts text in the composer for the user to finish. */
  onPrefill: () => void;
  /** Sends text as the user's message, as the Send button would. */
  onSend: (text: string) => void;
}

const todayIso = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Career's start surface under a new chat's composer: profile, ready queue, matches, tracker. */
export function CareerHome(props: CareerHomeProps) {
  const railEnabled = useClientSettings((settings) => settings.workspaceRailEnabled);
  const threadWorkspaces = useThreadWorkspaces();
  const serverConfig = useAtomValue(environmentServerConfigsAtom).get(props.environmentId);
  if (
    !railEnabled ||
    resolveThreadWorkspace({ id: props.threadId }, threadWorkspaces) !== "career"
  ) {
    return null;
  }
  const providers = serverConfig?.providers ?? [];
  if (serverConfig?.environment.capabilities.career !== true) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Update Gradespace on this machine to see your applications here. You can still ask the agent
        above.
      </p>
    );
  }
  return <CareerHomeWithReport {...props} providers={providers} />;
}

function CareerHomeWithReport(
  props: CareerHomeProps & { providers: ReadonlyArray<ServerProvider> },
) {
  const query = serverEnvironment.careerStatus({ environmentId: props.environmentId, input: {} });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  if (result._tag !== "Success") {
    return result.waiting ? (
      <p className="text-center text-xs text-muted-foreground">Loading your applications…</p>
    ) : null;
  }
  return <CareerHomeBody {...props} report={result.value} onRefresh={refresh} />;
}

function CareerHomeBody(
  props: CareerHomeProps & {
    providers: ReadonlyArray<ServerProvider>;
    report: CareerReport;
    onRefresh: () => void;
  },
) {
  const [reviewing, setReviewing] = useState<CareerApplication | null>(null);
  const today = todayIso();
  const home = careerHome(props.report, today);
  const skillInstalled = isSkillInstalled(JOBS_SKILL, props.providers);

  const run = (action: CareerAction, mode: "send" | "prefill") => {
    const drafts = useComposerDraftStore.getState();
    const prompt = drafts.getComposerDraft(props.composerDraftTarget)?.prompt ?? "";
    if (prompt.trim() !== "" && !isWorkspaceSeedPrompt(prompt)) {
      toastManager.add({
        type: "info",
        title: "Your message is still here",
        description: "Clear the message box first, then try again.",
      });
      return;
    }
    const text = careerPrompt(action, skillInstalled);
    setReviewing(null);
    if (mode === "send") {
      props.onSend(text);
      return;
    }
    drafts.setPrompt(props.composerDraftTarget, text);
    props.onPrefill();
  };

  const profile = props.report.profile;
  return (
    <section aria-label="Career home" className="flex flex-col gap-3">
      {profile === null ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/70 p-4 text-center">
          <h2 className="text-sm font-medium text-foreground">Set up your career profile</h2>
          <p className="max-w-md text-xs text-muted-foreground">
            Attach your CV (Word, PDF or a LinkedIn export) and any other experience. The agent
            builds a master CV, an evidence bank and a career record on this computer, for you to
            check before it applies anywhere.
          </p>
          <Button type="button" size="sm" onClick={() => run({ kind: "setup" }, "prefill")}>
            Set up profile
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card
            title="Your profile"
            action={
              <Button
                type="button"
                variant="ghost-muted"
                size="xs"
                onClick={() => run({ kind: "setup" }, "prefill")}
              >
                Edit
              </Button>
            }
          >
            <ul className="flex flex-col">
              {careerProfileRows(profile).map((row) => (
                <li key={row.item} className="flex min-h-7 items-center gap-2 text-sm">
                  <Dot
                    tone={row.state === "ready" ? "good" : row.state === "partial" ? "warn" : "bad"}
                  />
                  <span className="text-foreground">{row.label}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {rowDetail(row)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title="Ready for you"
            action={
              <span className="text-xs text-muted-foreground">
                {home.ready.length === 0 ? "Nothing yet" : `${home.ready.length} to send`}
              </span>
            }
            className="max-sm:order-first"
          >
            {home.ready.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Prepare a match and it waits here for your review.
              </p>
            ) : (
              home.ready.slice(0, 3).map((application) => (
                <JobRow key={application.id} application={application} today={today}>
                  <Button type="button" size="xs" onClick={() => setReviewing(application)}>
                    Review &amp; send
                  </Button>
                </JobRow>
              ))
            )}
          </Card>
          <Card
            title="New matches"
            action={
              <Button
                type="button"
                variant="ghost-muted"
                size="xs"
                onClick={() => run({ kind: "findMatches" }, "send")}
              >
                Find more
              </Button>
            }
          >
            {home.matches.length === 0 ? (
              <p className="text-xs text-muted-foreground">No matches yet. Find more to search.</p>
            ) : (
              home.matches.slice(0, 3).map((application) => (
                <JobRow key={application.id} application={application} today={today}>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => run({ kind: "prepare", id: application.id }, "send")}
                  >
                    Prepare
                  </Button>
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="xs"
                    onClick={() => run({ kind: "skip", id: application.id }, "send")}
                  >
                    Skip
                  </Button>
                </JobRow>
              ))
            )}
          </Card>
          <Card
            title="Tracker"
            action={
              <Button
                type="button"
                variant="ghost-muted"
                size="xs"
                aria-label="Check applications again"
                onClick={props.onRefresh}
              >
                Refresh
              </Button>
            }
          >
            <ul className="flex flex-col">
              <TrackerRow tone="good" label="Applied" value={home.applied} />
              <TrackerRow tone="warn" label="Interviews" value={home.interviews.length} />
              <TrackerRow tone="bad" label="Follow-ups due" value={home.followUpsDue.length} />
            </ul>
            {home.interviews[0] ? (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="self-start"
                onClick={() => run({ kind: "interview", id: home.interviews[0]?.id ?? "" }, "send")}
              >
                Interview prep for {home.interviews[0].title} →
              </Button>
            ) : null}
            {home.followUpsDue[0] ? (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="self-start"
                onClick={() =>
                  run({ kind: "followUp", id: home.followUpsDue[0]?.id ?? "" }, "send")
                }
              >
                Draft a follow-up for {home.followUpsDue[0].title} →
              </Button>
            ) : null}
          </Card>
        </div>
      )}
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheckIcon aria-hidden className="size-3.5 shrink-0" />
        {SAFETY_NOTE}
      </p>
      <ReviewDialog
        application={reviewing}
        statement={
          props.report.previews.find((preview) => preview.id === reviewing?.id)?.statement ?? null
        }
        onClose={() => setReviewing(null)}
        onAction={(action, mode) => run(action, mode)}
      />
    </section>
  );
}

function rowDetail(row: CareerProfileRow): string {
  if (row.detail) return `· ${row.detail}`;
  return row.state === "missing" ? "· not set up" : "";
}

function Card(props: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card/70 p-3",
        props.className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">{props.title}</h2>
        {props.action}
      </div>
      {props.children}
    </div>
  );
}

function JobRow(props: {
  application: CareerApplication;
  today: string;
  children: React.ReactNode;
}) {
  const { application } = props;
  const details = [
    application.employer,
    application.location,
    closingLabel(application.closingDate, props.today),
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm leading-tight font-medium text-foreground">
          {application.title}
        </span>
        <Score value={application.score} />
      </div>
      <span className="text-xs leading-tight text-muted-foreground">{details.join(" · ")}</span>
      {application.summary ? (
        <span className="text-xs leading-tight text-muted-foreground">{application.summary}</span>
      ) : null}
      <div className="flex gap-1.5">{props.children}</div>
    </div>
  );
}

function Score({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
        value >= 75
          ? "bg-success/15 text-success"
          : value >= 50
            ? "bg-warning/15 text-warning"
            : "bg-muted text-muted-foreground",
      )}
    >
      {Math.round(value)}%
    </span>
  );
}

function TrackerRow(props: { tone: "good" | "warn" | "bad"; label: string; value: number }) {
  return (
    <li className="flex min-h-7 items-center gap-2 text-sm">
      <Dot tone={props.tone} />
      <span className="text-foreground">{props.label}</span>
      <span className="ml-auto font-medium text-foreground">{props.value}</span>
    </li>
  );
}

function Dot({ tone }: { tone: "good" | "warn" | "bad" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-destructive",
      )}
    />
  );
}

function ReviewDialog(props: {
  application: CareerApplication | null;
  statement: string | null;
  onClose: () => void;
  onAction: (action: CareerAction, mode: "send" | "prefill") => void;
}) {
  const application = props.application;
  const unanswered = application?.needsYou?.filter((item) => !item.answer) ?? [];
  return (
    <Dialog open={application !== null} onOpenChange={(open) => (open ? null : props.onClose())}>
      {application ? (
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pe-8">
              <DialogTitle>
                {application.title} · {application.employer}
              </DialogTitle>
              <Score value={application.score} />
            </div>
            <DialogDescription>
              Everything the agent prepared. Send fills the form and submits this one application.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-3">
              {application.criteria && application.criteria.length > 0 ? (
                <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {application.criteria.map((criterion) => (
                    <li key={criterion.name} className="flex items-center gap-2 text-sm">
                      <Dot
                        tone={
                          criterion.fit === "strong"
                            ? "good"
                            : criterion.fit === "partial"
                              ? "warn"
                              : "bad"
                        }
                      />
                      <span className="text-foreground">{criterion.name}</span>
                      {criterion.fit === "strong" ? null : (
                        <span className="text-xs text-muted-foreground">· {criterion.fit}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {props.statement ? (
                <p className="text-xs text-muted-foreground">
                  Highlighted lines each come from an example in your evidence bank.
                </p>
              ) : null}
              {props.statement ? (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border p-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {statementSegments(props.statement).map((segment, index) =>
                    segment.evidence ? (
                      <mark
                        // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed split of one text
                        key={index}
                        className="rounded-sm bg-info/20 px-0.5 text-foreground"
                      >
                        {segment.text}
                      </mark>
                    ) : (
                      // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed split of one text
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </div>
              ) : null}
              {unanswered.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Needs you</h3>
                  {unanswered.map((item) => (
                    <div
                      key={item.question}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="text-foreground">{item.question}</span>
                      <span className="text-xs text-muted-foreground">The agent will ask</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onAction({ kind: "skip", id: application.id }, "send")}
            >
              Skip
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onAction({ kind: "revise", id: application.id }, "prefill")}
            >
              Edit with agent
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onAction({ kind: "fill", id: application.id }, "send")}
            >
              Open form
            </Button>
            <Button
              type="button"
              onClick={() => props.onAction({ kind: "submit", id: application.id }, "send")}
            >
              Send application
            </Button>
          </DialogFooter>
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}
