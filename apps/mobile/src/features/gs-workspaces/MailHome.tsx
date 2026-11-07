import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  emailConnectGuide,
  emailProviderRows,
  MAIL_QUICK_JOBS,
  MAIL_SAFETY_NOTE,
  MAIL_SKILL,
  mailQuickJobPrompt,
  preferredEmailProvider,
  type EmailProviderRow,
  type MailQuickJob,
} from "@t3tools/client-runtime/mailHome";
import { isSkillInstalled } from "@t3tools/client-runtime/workspaces";
import type {
  EmailConnectionsReport,
  EnvironmentId,
  ProviderDriverKind,
  ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { cn } from "../../lib/cn";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useStickyComposerModelSelection } from "../../state/use-composer-drafts";
import { requestNewTaskSeed } from "./workspacePreferences";

const STATE_PRESENTATION = {
  connected: { dot: "bg-adaptive-emerald-600-400", label: "Connected" },
  notConnected: { dot: "bg-danger-foreground", label: "Not connected" },
  unknown: { dot: "bg-adaptive-neutral-400-500", label: "Unknown" },
} as const;

export function ListPillButton(props: {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={6}
      className={cn(
        "min-h-8 flex-row items-center rounded-2xl border border-border px-3 active:opacity-70",
        props.disabled && "opacity-50",
      )}
    >
      <Text textRole="footnote" className="font-t3-medium text-foreground">
        {props.label}
      </Text>
    </Pressable>
  );
}

interface EmailReport {
  readonly report: EmailConnectionsReport | null;
  readonly checking: boolean;
  readonly check: (() => void) | null;
}

/** Only servers with the RPC are asked; older ones leave every row unknown. */
function EmailReportQuery(props: {
  readonly environmentId: EnvironmentId;
  readonly children: (report: EmailReport) => ReactNode;
}) {
  const query = serverEnvironment.emailConnectionsStatus({
    environmentId: props.environmentId,
    input: {},
  });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  return props.children({
    report: AsyncResult.isSuccess(result) ? result.value : null,
    checking: result.waiting,
    check: refresh,
  });
}

/** Mail's start surface: who can reach email here, four quick jobs, and the drafts-only promise. */
export function MailHome(props: {
  readonly environmentId: EnvironmentId | null;
  readonly compact?: boolean;
  readonly onStartNewTask: () => void;
}) {
  const serverConfigs = useServerConfigs();
  const config = props.environmentId === null ? null : serverConfigs.get(props.environmentId);
  const body = (email: EmailReport) => (
    <MailHomeBody
      email={email}
      providers={config?.providers ?? []}
      compact={props.compact === true}
      onStartNewTask={props.onStartNewTask}
    />
  );
  if (props.environmentId !== null && config?.environment.capabilities.emailConnections === true) {
    return <EmailReportQuery environmentId={props.environmentId}>{body}</EmailReportQuery>;
  }
  return body({ report: null, checking: false, check: null });
}

function MailHomeBody(props: {
  readonly email: EmailReport;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly compact: boolean;
  readonly onStartNewTask: () => void;
}) {
  const sticky = useStickyComposerModelSelection();
  const [guideDriver, setGuideDriver] = useState<ProviderDriverKind | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const rows = emailProviderRows(props.providers, props.email.report);
  const skillInstalled = isSkillInstalled(MAIL_SKILL, props.providers);

  const startJob = (job: MailQuickJob) => {
    requestNewTaskSeed(
      mailQuickJobPrompt(job, skillInstalled),
      preferredEmailProvider(rows, sticky?.instanceId ?? null),
    );
    props.onStartNewTask();
  };

  const emailCard = (
    <EmailCard
      rows={rows}
      email={props.email}
      onHowToConnect={(driver) => {
        setDetailsOpen(false);
        setGuideDriver(driver);
      }}
    />
  );
  const guideSheet =
    guideDriver === null ? null : (
      <ConnectGuideSheet driver={guideDriver} onClose={() => setGuideDriver(null)} />
    );

  if (props.compact) {
    const connected = rows.filter((row) => row.state === "connected").map((row) => row.label);
    return (
      <View className="gap-2 px-5 pb-3 pt-0.5">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
          accessibilityLabel="Start a mail job"
        >
          {MAIL_QUICK_JOBS.map((job) => (
            <QuickJobTile key={job.id} job={job} compact onPress={() => startJob(job)} />
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your email connections"
          accessibilityHint="Shows which agents can reach your email"
          onPress={() => setDetailsOpen(true)}
          className="min-h-8 flex-row items-center gap-2 active:opacity-70"
        >
          <Text textRole="label" className="min-w-0 flex-1 text-foreground-muted" numberOfLines={1}>
            {connected.length > 0
              ? `Email: ${connected.join(", ")} connected · drafts only`
              : "Email: no agent connected yet · drafts only"}
          </Text>
          <Text textRole="label" className="font-t3-medium text-primary-text">
            Details
          </Text>
        </Pressable>
        {detailsOpen ? (
          <Sheet title="Your email" onClose={() => setDetailsOpen(false)}>
            <ScrollView
              contentInsetAdjustmentBehavior="automatic"
              contentContainerClassName="gap-4 px-4 pb-10 pt-2"
            >
              {emailCard}
              <Text textRole="footnote" className="text-foreground-muted">
                {MAIL_SAFETY_NOTE}
              </Text>
            </ScrollView>
          </Sheet>
        ) : null}
        {guideSheet}
      </View>
    );
  }

  return (
    <View className="w-full gap-3">
      {emailCard}
      <View className="gap-2 rounded-2xl border border-border bg-card p-3.5">
        <Text
          textRole="headline"
          accessibilityRole="header"
          className="font-t3-bold text-foreground"
        >
          Start
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {MAIL_QUICK_JOBS.map((job) => (
            <QuickJobTile key={job.id} job={job} onPress={() => startJob(job)} />
          ))}
        </View>
      </View>
      <Text textRole="footnote" className="px-1 text-foreground-muted">
        {MAIL_SAFETY_NOTE}
      </Text>
      {guideSheet}
    </View>
  );
}

function EmailCard(props: {
  readonly rows: ReadonlyArray<EmailProviderRow>;
  readonly email: EmailReport;
  readonly onHowToConnect: (driver: ProviderDriverKind) => void;
}) {
  const { check } = props.email;
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-3.5">
      <View className="flex-row items-center gap-2">
        <Text
          textRole="headline"
          accessibilityRole="header"
          className="min-w-0 flex-1 font-t3-bold text-foreground"
        >
          Your email
        </Text>
        {check ? (
          <ListPillButton
            label={props.email.checking ? "Checking…" : "Check"}
            accessibilityLabel="Check email connections again"
            disabled={props.email.checking}
            onPress={check}
          />
        ) : null}
      </View>
      {props.rows.length === 0 ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Neither Codex nor Claude is set up on this environment.
        </Text>
      ) : null}
      {props.rows.map((row) => {
        const presentation = STATE_PRESENTATION[row.state];
        const stateLabel =
          row.state === "connected" && row.connectors.length > 0
            ? `${row.connectors.join(", ")} connected`
            : presentation.label;
        return (
          <View
            key={row.instanceId}
            accessible={row.state !== "notConnected"}
            accessibilityLabel={`${row.label}: ${stateLabel}`}
            className="min-h-10 flex-row items-center gap-3"
          >
            <View className={cn("size-2.5 rounded-full", presentation.dot)} />
            <View className="min-w-0 flex-1">
              <Text textRole="footnote" className="font-t3-medium text-foreground">
                {row.label}
              </Text>
              <Text textRole="label" className="text-foreground-muted">
                {stateLabel}
              </Text>
            </View>
            {row.state === "notConnected" ? (
              <ListPillButton
                label="How to connect"
                accessibilityLabel={`How to connect email to ${row.label}`}
                onPress={() => props.onHowToConnect(row.driver)}
              />
            ) : null}
          </View>
        );
      })}
      <View
        accessible
        accessibilityLabel="Outlook, coming later"
        className="min-h-10 flex-row items-center gap-3 opacity-60"
      >
        <View className="size-2.5 rounded-full border border-border" />
        <Text textRole="footnote" className="text-foreground-muted">
          Outlook · coming later
        </Text>
      </View>
    </View>
  );
}

function QuickJobTile(props: {
  readonly job: MailQuickJob;
  readonly compact?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.job.title}: ${props.job.detail}`}
      accessibilityHint="Starts a new Mail chat"
      onPress={props.onPress}
      className={cn(
        "gap-0.5 rounded-xl border border-border bg-screen px-3 py-2.5 active:opacity-70",
        props.compact ? "w-40" : "min-w-[46%] flex-1",
      )}
    >
      <Text textRole="footnote" className="font-t3-medium text-foreground" numberOfLines={1}>
        {props.job.title}
      </Text>
      <Text textRole="label" className="text-foreground-muted" numberOfLines={1}>
        {props.job.detail}
      </Text>
    </Pressable>
  );
}

function ConnectGuideSheet(props: {
  readonly driver: ProviderDriverKind;
  readonly onClose: () => void;
}) {
  const guide = emailConnectGuide(props.driver);
  const { link } = guide;
  return (
    <Sheet title={guide.title} onClose={props.onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-4 pb-10 pt-2"
      >
        <View accessibilityRole="list" className="gap-3">
          {guide.steps.map((step, index) => (
            <View key={step} className="flex-row gap-3">
              <Text textRole="body" className="w-5 font-t3-bold text-foreground-muted">
                {index + 1}.
              </Text>
              <Text textRole="body" className="min-w-0 flex-1 text-foreground">
                {step}
              </Text>
            </View>
          ))}
        </View>
        {link ? (
          <Button
            label={link.label}
            icon="arrow.up.right"
            tone="primary"
            onPress={() => void Linking.openURL(link.url)}
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
