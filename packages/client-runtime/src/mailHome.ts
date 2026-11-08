import type {
  EmailConnectionState,
  EmailConnectionsReport,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

/** Providers whose agent can reach email through its own connectors. */
const EMAIL_DRIVER_LABELS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claudeAgent: "Claude",
};

export const MAIL_SKILL = "gs-mail";

export const MAIL_SAFETY_NOTE =
  "Nothing is ever sent without you: replies and invites are saved as drafts for you to approve.";

const CLAUDE_CONNECTORS_URL = "https://claude.ai/new#customize/connectors";

export interface EmailProviderRow {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly state: EmailConnectionState;
  readonly connectors: ReadonlyArray<string>;
}

export interface EmailProviderCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName?: string | undefined;
  readonly enabled: boolean;
}

/**
 * One row per enabled Codex or Claude instance on the environment. A missing report (an older
 * server, or still loading) leaves every row unknown rather than failing.
 */
export function emailProviderRows(
  providers: ReadonlyArray<EmailProviderCandidate>,
  report: EmailConnectionsReport | null,
): ReadonlyArray<EmailProviderRow> {
  return providers.flatMap((provider) => {
    const driverLabel = EMAIL_DRIVER_LABELS[provider.driver];
    if (driverLabel === undefined || !provider.enabled) return [];
    const status = report?.providers.find((entry) => entry.instanceId === provider.instanceId);
    return [
      {
        instanceId: provider.instanceId,
        driver: provider.driver,
        label: provider.displayName ?? driverLabel,
        state: status?.state ?? "unknown",
        connectors: status?.connectors ?? [],
      },
    ];
  });
}

/** The instance a Mail job should run on: null keeps the current one. */
export function preferredEmailProvider(
  rows: ReadonlyArray<EmailProviderRow>,
  currentInstanceId: ProviderInstanceId | null,
): ProviderInstanceId | null {
  const current = rows.find((row) => row.instanceId === currentInstanceId);
  if (current?.state === "connected") return null;
  return rows.find((row) => row.state === "connected")?.instanceId ?? null;
}

export interface EmailConnectGuide {
  readonly title: string;
  readonly steps: ReadonlyArray<string>;
  readonly link: { readonly label: string; readonly url: string } | null;
}

export function emailConnectGuide(driver: ProviderDriverKind): EmailConnectGuide {
  if (driver === "codex") {
    return {
      title: "Connect Gmail to Codex",
      steps: [
        "Open the ChatGPT or Codex app on this computer.",
        "Go to Plugins and choose Gmail.",
        "Select Connect and sign in to your Google account.",
        "Come back here and select Check.",
      ],
      link: null,
    };
  }
  return {
    title: "Connect Gmail to Claude",
    steps: [
      "Open claude.ai and select Customize, then Connectors.",
      "Under Discover, find Gmail and select +, then sign in to your Google account.",
      "Come back here and select Check.",
    ],
    link: { label: "Open claude.ai connectors", url: CLAUDE_CONNECTORS_URL },
  };
}

export interface MailQuickJob {
  readonly id: "triage" | "reply" | "meeting" | "followUps";
  readonly title: string;
  readonly detail: string;
  readonly request: string;
}

export const MAIL_QUICK_JOBS: ReadonlyArray<MailQuickJob> = [
  {
    id: "triage",
    title: "Triage my inbox",
    detail: "What needs me today",
    request: "Triage my inbox: what needs me today? Drafts only.",
  },
  {
    id: "reply",
    title: "Draft a reply",
    detail: "Pick an email",
    request:
      "Help me draft a reply: show my recent emails that need one so I can pick. Drafts only.",
  },
  {
    id: "meeting",
    title: "Find a meeting time",
    detail: "From your calendar",
    request:
      "Find a meeting time from my calendar and draft the invite. Ask me who and how long first. Drafts only.",
  },
  {
    id: "followUps",
    title: "Follow-ups",
    detail: "Who hasn't replied",
    request: "Find emails I sent that haven't had a reply and draft follow-ups. Drafts only.",
  },
];

/** The composer text a quick job starts with; the request alone when gs-mail is missing. */
export function mailQuickJobPrompt(job: MailQuickJob, skillInstalled: boolean): string {
  return skillInstalled ? `$${MAIL_SKILL} ${job.request}` : job.request;
}

/** True for a quick job's own text, which another quick job may replace. */
export function isMailQuickJobPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return MAIL_QUICK_JOBS.some(
    (job) => text === job.request || text === mailQuickJobPrompt(job, true),
  );
}
