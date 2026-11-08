import type {
  CareerApplication,
  CareerProfile,
  CareerProfileItem,
  CareerReport,
} from "@t3tools/contracts";

const JOBS_SKILL = "gs-jobs";

const CAREER_PROFILE_LABELS: Readonly<Record<CareerProfileItem, string>> = {
  careerRecord: "Career record",
  evidenceBank: "Evidence bank",
  masterCv: "Master CV",
  preferences: "Preferences",
};

const PREFERENCE_LABELS: Readonly<Record<string, string>> = {
  roles: "roles",
  locations: "locations",
  salaryFloor: "salary floor",
  workPattern: "work pattern",
  sites: "job sites",
};

export interface CareerProfileRow {
  readonly item: CareerProfileItem;
  readonly label: string;
  readonly state: "ready" | "partial" | "missing";
  readonly detail: string | null;
}

/** The profile card's rows; preferences are partial while any field is still empty. */
export function careerProfileRows(profile: CareerProfile): ReadonlyArray<CareerProfileRow> {
  return profile.items.map(({ item, present }) => {
    const label = CAREER_PROFILE_LABELS[item];
    if (item !== "preferences") {
      return { item, label, state: present ? "ready" : "missing", detail: null };
    }
    const missing = profile.missingPreferences.map((key) => PREFERENCE_LABELS[key] ?? key);
    if (!present) return { item, label, state: "missing", detail: null };
    return missing.length === 0
      ? { item, label, state: "ready", detail: null }
      : { item, label, state: "partial", detail: `add ${missing.join(", ")}` };
  });
}

export interface CareerHome {
  /** Prepared and waiting for the user's Send, soonest closing first. */
  readonly ready: ReadonlyArray<CareerApplication>;
  /** Found but not prepared, best match first. */
  readonly matches: ReadonlyArray<CareerApplication>;
  readonly applied: number;
  readonly interviews: ReadonlyArray<CareerApplication>;
  readonly followUpsDue: ReadonlyArray<CareerApplication>;
}

const byClosingDate = (left: CareerApplication, right: CareerApplication) =>
  (left.closingDate ?? "9999").localeCompare(right.closingDate ?? "9999");

/** `today` is `YYYY-MM-DD`; closed adverts drop out of the ready and match lists. */
export function careerHome(report: CareerReport, today: string): CareerHome {
  const open = (application: CareerApplication) =>
    application.closingDate == null || application.closingDate >= today;
  const withStatus = (status: CareerApplication["status"]) =>
    report.applications.filter((application) => application.status === status);
  return {
    ready: withStatus("ready").filter(open).sort(byClosingDate),
    matches: withStatus("match")
      .filter(open)
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0)),
    applied: withStatus("applied").length,
    interviews: withStatus("interview").sort((left, right) =>
      (left.interviewAt ?? "9999").localeCompare(right.interviewAt ?? "9999"),
    ),
    followUpsDue: withStatus("applied").filter(
      (application) => application.followUpAt != null && application.followUpAt <= today,
    ),
  };
}

export type CareerAction =
  | { readonly kind: "setup" }
  | { readonly kind: "findMatches" }
  | { readonly kind: "prepare"; readonly id: string }
  | { readonly kind: "fill"; readonly id: string }
  | { readonly kind: "submit"; readonly id: string }
  | { readonly kind: "revise"; readonly id: string }
  | { readonly kind: "skip"; readonly id: string }
  | { readonly kind: "polish"; readonly id: string }
  | { readonly kind: "interview"; readonly id: string }
  | { readonly kind: "followUp"; readonly id: string };

function careerRequest(action: CareerAction): string {
  switch (action.kind) {
    case "setup":
      return "Set up my career profile.";
    case "findMatches":
      return "Find new matches.";
    case "prepare":
      return `Prepare application ${action.id}.`;
    case "fill":
      return `Fill application ${action.id} and stop before Submit.`;
    case "submit":
      return `Submit application ${action.id}`;
    case "revise":
      return `Revise application ${action.id}: `;
    case "polish":
      return `Polish application ${action.id}: check the word limits and make it sound natural.`;
    case "skip":
      return `Skip application ${action.id}.`;
    case "interview":
      return `Prep me for the interview for ${action.id}.`;
    case "followUp":
      return `Draft a follow-up for application ${action.id}. Drafts only.`;
  }
}

/** The composer text a Career button starts a chat with; the request alone without gs-jobs. */
export function careerPrompt(action: CareerAction, skillInstalled: boolean): string {
  const request = careerRequest(action);
  return skillInstalled ? `$${JOBS_SKILL} ${request}` : request;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short closing-date wording, such as "closes 14 Nov", from a `YYYY-MM-DD` date. */
export function closingLabel(closingDate: string | null | undefined, today: string): string | null {
  if (!closingDate) return null;
  if (closingDate === today) return "closes today";
  const match = /^\d{4}-(\d{2})-(\d{2})$/u.exec(closingDate);
  const month = match ? MONTHS[Number(match[1]) - 1] : undefined;
  return match && month ? `closes ${Number(match[2])} ${month}` : null;
}

export interface StatementSegment {
  readonly text: string;
  /** The evidence-bank example a claim came from; null for connecting text. */
  readonly evidence: string | null;
}

const EVIDENCE_MARKER = /<!--\s*evidence:\s*(.*?)\s*-->/gu;

/**
 * gs-jobs marks a claim with `<!-- evidence: name -->` after its sentence. The sentence before
 * each marker becomes an evidenced segment; markdown emphasis is dropped.
 */
export function statementSegments(statement: string): ReadonlyArray<StatementSegment> {
  const segments: StatementSegment[] = [];
  let rest = "";
  let last = 0;
  const clean = (text: string) => text.replace(/[*_`#]+/gu, "");
  for (const match of statement.matchAll(EVIDENCE_MARKER)) {
    const before = clean(rest + statement.slice(last, match.index));
    // The marker may follow the sentence's own trailing space; search before it.
    const body = before.trimEnd();
    const sentenceStart = Math.max(body.lastIndexOf(". ") + 1, body.lastIndexOf("\n") + 1, 0);
    const lead = before.slice(0, sentenceStart);
    const claim = before.slice(sentenceStart);
    if (lead) segments.push({ text: lead, evidence: null });
    if (claim.trim()) segments.push({ text: claim, evidence: match[1] ?? null });
    rest = "";
    last = (match.index ?? 0) + match[0].length;
  }
  const tail = clean(statement.slice(last));
  if (tail) segments.push({ text: tail, evidence: null });
  return segments;
}

export interface DocumentCheck {
  readonly name: string;
  readonly label: string;
  readonly state: "ok" | "over" | "issues";
}

/** "Cover letter · 298 / 300 words", and whether it's within its limit with nothing flagged. */
export function documentChecks(application: CareerApplication): ReadonlyArray<DocumentCheck> {
  return (application.documents ?? []).map((document) => {
    const unit = document.unit ?? "words";
    const count =
      document.limit == null
        ? `${document.words} ${unit}`
        : `${document.words} / ${document.limit} ${unit}`;
    const over = document.limit != null && document.words > document.limit;
    const issues = (document.flags ?? 0) > 0;
    return {
      name: document.name,
      label: `${document.name} · ${count}${issues ? ` · ${document.flags} to fix` : ""}`,
      state: over ? "over" : issues ? "issues" : "ok",
    };
  });
}
