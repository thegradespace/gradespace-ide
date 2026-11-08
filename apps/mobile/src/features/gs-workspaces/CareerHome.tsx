import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type CareerAction,
  careerHome,
  careerProfileRows,
  careerPrompt,
  closingLabel,
  documentChecks,
  rememberByDefault,
  statementSegments,
} from "@t3tools/client-runtime/career";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isSkillInstalled } from "@t3tools/client-runtime/workspaces";
import type {
  CareerApplication,
  CareerReport,
  EnvironmentId,
  ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { Sheet } from "../../components/ui/Sheet";
import { cn } from "../../lib/cn";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListPillButton } from "./MailHome";
import { requestNewTaskSeed } from "./workspacePreferences";

const JOBS_SKILL = "gs-jobs";
const SAFETY_NOTE =
  "Nothing is submitted without you: the agent fills each form and stops at Submit.";

const todayIso = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Career's start surface on the phone: the ready queue, new matches, profile and tracker. */
export function CareerHome(props: {
  readonly environmentId: EnvironmentId | null;
  readonly compact?: boolean;
  readonly onStartNewTask: () => void;
}) {
  const serverConfigs = useServerConfigs();
  const config = props.environmentId === null ? null : serverConfigs.get(props.environmentId);
  if (props.environmentId === null || config?.environment.capabilities.career !== true) {
    return (
      <Text textRole="footnote" className="px-5 py-2 text-center text-foreground-muted">
        Update Gradespace on your computer to see your applications here.
      </Text>
    );
  }
  return (
    <CareerReportQuery
      environmentId={props.environmentId}
      providers={config.providers}
      compact={props.compact === true}
      onStartNewTask={props.onStartNewTask}
    />
  );
}

function CareerReportQuery(props: {
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly compact: boolean;
  readonly onStartNewTask: () => void;
}) {
  const query = serverEnvironment.careerStatus({ environmentId: props.environmentId, input: {} });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  if (!AsyncResult.isSuccess(result)) return null;
  return (
    <CareerHomeBody
      {...props}
      environmentId={props.environmentId}
      report={result.value}
      onRefresh={refresh}
    />
  );
}

function CareerHomeBody(props: {
  readonly environmentId: EnvironmentId;
  readonly report: CareerReport;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly compact: boolean;
  readonly onStartNewTask: () => void;
  readonly onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  // By id, so saved answers show as soon as the report refreshes.
  const reviewing =
    props.report.applications.find((application) => application.id === reviewingId) ?? null;
  const setReviewing = (application: CareerApplication | null) =>
    setReviewingId(application?.id ?? null);
  const today = todayIso();
  const home = careerHome(props.report, today);
  const skillInstalled = isSkillInstalled(JOBS_SKILL, props.providers);
  const start = (action: CareerAction) => {
    setReviewing(null);
    setOpen(false);
    requestNewTaskSeed(careerPrompt(action, skillInstalled), null);
    props.onStartNewTask();
  };

  const body = (
    <View className="w-full gap-3">
      {props.report.profile === null ? (
        <Card title="Set up your career profile">
          <Text textRole="footnote" className="text-foreground-muted">
            Attach your CV and any other experience. The agent builds a master CV, an evidence bank
            and a career record on your computer, for you to check before it applies anywhere.
          </Text>
          <Button label="Set up profile" tone="primary" onPress={() => start({ kind: "setup" })} />
        </Card>
      ) : (
        <>
          <Card title={`Ready for you · ${home.ready.length}`}>
            {home.ready.length === 0 ? (
              <Text textRole="footnote" className="text-foreground-muted">
                Prepare a match and it waits here for your review.
              </Text>
            ) : (
              home.ready.map((application) => (
                <JobRow key={application.id} application={application} today={today}>
                  <ListPillButton label="Review" onPress={() => setReviewing(application)} />
                  <ListPillButton
                    label="Send"
                    accessibilityLabel={`Send application for ${application.title}`}
                    onPress={() => start({ kind: "submit", id: application.id })}
                  />
                </JobRow>
              ))
            )}
          </Card>
          <Card
            title={`New matches · ${home.matches.length}`}
            action={
              <ListPillButton label="Find more" onPress={() => start({ kind: "findMatches" })} />
            }
          >
            {home.matches.slice(0, 5).map((application) => (
              <JobRow key={application.id} application={application} today={today}>
                <ListPillButton
                  label="Prepare"
                  onPress={() => start({ kind: "prepare", id: application.id })}
                />
                <ListPillButton
                  label="Skip"
                  onPress={() => start({ kind: "skip", id: application.id })}
                />
              </JobRow>
            ))}
          </Card>
          <Card
            title="Profile and tracker"
            action={<ListPillButton label="Refresh" onPress={props.onRefresh} />}
          >
            <View className="flex-row flex-wrap gap-x-4 gap-y-1">
              {careerProfileRows(props.report.profile).map((row) => (
                <View key={row.item} className="flex-row items-center gap-1.5">
                  <Dot
                    tone={row.state === "ready" ? "good" : row.state === "partial" ? "warn" : "bad"}
                  />
                  <Text textRole="label" className="text-foreground">
                    {row.label}
                  </Text>
                </View>
              ))}
            </View>
            <Text textRole="footnote" className="text-foreground-muted">
              Applied {home.applied} · Interviews {home.interviews.length} · Follow-ups due{" "}
              {home.followUpsDue.length}
            </Text>
            {home.interviews[0] ? (
              <ListPillButton
                label={`Interview prep: ${home.interviews[0].title}`}
                onPress={() => start({ kind: "interview", id: home.interviews[0]?.id ?? "" })}
              />
            ) : null}
          </Card>
        </>
      )}
      <Text textRole="footnote" className="px-1 text-foreground-muted">
        {SAFETY_NOTE}
      </Text>
    </View>
  );

  const review =
    reviewing === null ? null : (
      <ReviewSheet
        application={reviewing}
        statement={
          props.report.previews.find((preview) => preview.id === reviewing.id)?.statement ?? null
        }
        environmentId={props.environmentId}
        onAnswered={props.onRefresh}
        onClose={() => setReviewing(null)}
        onAction={start}
      />
    );

  if (props.compact) {
    return (
      <View className="gap-2 px-5 pb-3 pt-0.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your applications"
          accessibilityHint="Shows applications ready to send and new matches"
          onPress={() => setOpen(true)}
          className="min-h-8 flex-row items-center gap-2 active:opacity-70"
        >
          <Text textRole="label" className="min-w-0 flex-1 text-foreground-muted" numberOfLines={1}>
            {props.report.profile === null
              ? "Career: set up your profile"
              : `Career: ${home.ready.length} ready to send · ${home.matches.length} new matches`}
          </Text>
          <Text textRole="label" className="font-t3-medium text-primary-text">
            Open
          </Text>
        </Pressable>
        {open ? (
          <Sheet title="Career" onClose={() => setOpen(false)}>
            <ScrollView
              contentInsetAdjustmentBehavior="automatic"
              contentContainerClassName="gap-4 px-4 pb-10 pt-2"
            >
              {body}
            </ScrollView>
          </Sheet>
        ) : null}
        {review}
      </View>
    );
  }
  return (
    <View className="w-full">
      {body}
      {review}
    </View>
  );
}

function Card(props: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-3.5">
      <View className="flex-row items-center gap-2">
        <Text
          textRole="headline"
          accessibilityRole="header"
          className="min-w-0 flex-1 font-t3-bold text-foreground"
        >
          {props.title}
        </Text>
        {props.action}
      </View>
      {props.children}
    </View>
  );
}

function JobRow(props: {
  readonly application: CareerApplication;
  readonly today: string;
  readonly children: React.ReactNode;
}) {
  const { application } = props;
  const details = [
    application.employer,
    closingLabel(application.closingDate, props.today),
    application.summary,
  ].filter(Boolean);
  return (
    <View className="gap-1.5 rounded-xl border border-border bg-screen px-3 py-2.5">
      <View className="flex-row items-start gap-2">
        <Text textRole="footnote" className="min-w-0 flex-1 font-t3-medium text-foreground">
          {application.title}
        </Text>
        {application.score == null ? null : (
          <Text
            textRole="label"
            className={cn(
              "font-t3-bold",
              application.score >= 75
                ? "text-adaptive-emerald-600-400"
                : application.score >= 50
                  ? "text-adaptive-amber-700-300"
                  : "text-foreground-muted",
            )}
          >
            {Math.round(application.score)}%
          </Text>
        )}
      </View>
      <Text textRole="label" className="text-foreground-muted">
        {details.join(" · ")}
      </Text>
      <View className="flex-row gap-2">{props.children}</View>
    </View>
  );
}

function Dot(props: { readonly tone: "good" | "warn" | "bad" }) {
  return (
    <View
      className={cn(
        "size-2 rounded-full",
        props.tone === "good"
          ? "bg-adaptive-emerald-600-400"
          : props.tone === "warn"
            ? "bg-adaptive-amber-700-300"
            : "bg-danger-foreground",
      )}
    />
  );
}

function ReviewSheet(props: {
  readonly application: CareerApplication;
  readonly statement: string | null;
  readonly environmentId: EnvironmentId;
  readonly onAnswered: () => void;
  readonly onClose: () => void;
  readonly onAction: (action: CareerAction) => void;
}) {
  const { application } = props;
  const unanswered = application.needsYou?.filter((item) => !item.answer) ?? [];
  return (
    <Sheet title={application.title} onClose={props.onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-4 pb-10 pt-2"
      >
        <Text textRole="footnote" className="text-foreground-muted">
          {[application.employer, application.location, application.salary]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {application.criteria?.map((criterion) => (
          <View key={criterion.name} className="flex-row items-center gap-2">
            <Dot
              tone={
                criterion.fit === "strong" ? "good" : criterion.fit === "partial" ? "warn" : "bad"
              }
            />
            <Text textRole="footnote" className="text-foreground">
              {criterion.name}
              {criterion.fit === "strong" ? "" : ` · ${criterion.fit}`}
            </Text>
          </View>
        ))}
        {documentChecks(application).map((check) => (
          <Text
            key={check.name}
            textRole="footnote"
            className={cn(
              check.state === "ok"
                ? "text-adaptive-emerald-600-400"
                : check.state === "over"
                  ? "text-danger-foreground"
                  : "text-adaptive-amber-700-300",
            )}
          >
            {check.state === "ok" ? "✓ " : ""}
            {check.label}
          </Text>
        ))}
        {props.statement ? (
          <View className="gap-1.5">
            <Text textRole="label" className="text-foreground-muted">
              Highlighted lines each come from an example in your evidence bank.
            </Text>
            <Text textRole="footnote" className="text-foreground-muted">
              {statementSegments(props.statement).map((segment, index) => (
                <Text
                  // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed split of one text
                  key={index}
                  className={segment.evidence ? "text-foreground underline" : undefined}
                >
                  {segment.text}
                </Text>
              ))}
            </Text>
          </View>
        ) : null}
        {unanswered.length > 0 ? (
          <NeedsYouForm
            key={application.id}
            applicationId={application.id}
            questions={unanswered.map((item) => item.question)}
            environmentId={props.environmentId}
            onSaved={props.onAnswered}
          />
        ) : null}
        <Button
          label="Send application"
          tone="primary"
          onPress={() => props.onAction({ kind: "submit", id: application.id })}
        />
        <View className="flex-row gap-2">
          <ListPillButton
            label="Edit with agent"
            onPress={() => props.onAction({ kind: "revise", id: application.id })}
          />
          <ListPillButton
            label="Polish"
            onPress={() => props.onAction({ kind: "polish", id: application.id })}
          />
          <ListPillButton
            label="Skip"
            onPress={() => props.onAction({ kind: "skip", id: application.id })}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

function NeedsYouForm(props: {
  readonly applicationId: string;
  readonly questions: ReadonlyArray<string>;
  readonly environmentId: EnvironmentId;
  readonly onSaved: () => void;
}) {
  const save = useAtomCommand(serverEnvironment.answerCareerQuestions, { reportFailure: false });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(props.questions.map((question) => [question, rememberByDefault(question)])),
  );
  const [saving, setSaving] = useState(false);
  const filled = props.questions.filter((question) => (answers[question] ?? "").trim() !== "");

  const onSave = async () => {
    if (saving || filled.length === 0) return;
    setSaving(true);
    const result = await save({
      environmentId: props.environmentId,
      input: {
        id: props.applicationId,
        answers: filled.map((question) => ({
          question,
          answer: (answers[question] ?? "").trim(),
          remember: remember[question] === true,
        })),
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      props.onSaved();
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      Dialog.alert(
        "Could not save your answers",
        failure instanceof Error ? failure.message : "Try again in a moment.",
      );
    }
  };

  return (
    <View className="gap-2">
      <Text textRole="headline" className="font-t3-bold text-foreground">
        Needs you
      </Text>
      <Text textRole="label" className="text-foreground-muted">
        The agent uses these when it fills the form.
      </Text>
      {props.questions.map((question) => (
        <View key={question} className="gap-2 rounded-xl border border-border bg-screen p-3">
          <Text textRole="footnote" className="text-foreground">
            {question}
          </Text>
          <TextInput
            accessibilityLabel={question}
            value={answers[question] ?? ""}
            onChangeText={(value) => setAnswers((current) => ({ ...current, [question]: value }))}
            placeholder="Your answer"
            placeholderTextColorClassName="accent-foreground-muted"
            className="min-h-10 rounded-lg border border-border px-3 font-sans text-base text-foreground"
          />
          <View className="flex-row items-center gap-2">
            <Text textRole="label" className="min-w-0 flex-1 text-foreground-muted">
              Use for every application
            </Text>
            <ThemedSwitch
              accessibilityLabel={`Use this answer for every application: ${question}`}
              value={remember[question] === true}
              onValueChange={(value) =>
                setRemember((current) => ({ ...current, [question]: value }))
              }
            />
          </View>
        </View>
      ))}
      <Button
        label={
          saving ? "Saving…" : filled.length > 1 ? `Save ${filled.length} answers` : "Save answer"
        }
        disabled={saving || filled.length === 0}
        onPress={() => void onSave()}
      />
    </View>
  );
}
