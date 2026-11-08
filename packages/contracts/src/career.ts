import * as Schema from "effect/Schema";

export const CareerApplicationStatus = Schema.Literals([
  "match",
  "ready",
  "applied",
  "interview",
  "offer",
  "rejected",
  "skipped",
]);
export type CareerApplicationStatus = typeof CareerApplicationStatus.Type;

export const CareerCriterionFit = Schema.Literals(["strong", "partial", "gap"]);
export type CareerCriterionFit = typeof CareerCriterionFit.Type;

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

/** One entry of `~/.gradespace/career/applications.json`, which the gs-jobs skill writes. */
export const CareerApplication = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  employer: Schema.String,
  url: OptionalText,
  site: OptionalText,
  location: OptionalText,
  salary: OptionalText,
  closingDate: OptionalText,
  score: Schema.optional(Schema.NullOr(Schema.Number)),
  summary: OptionalText,
  criteria: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, fit: CareerCriterionFit })),
  ),
  status: CareerApplicationStatus,
  needsYou: Schema.optional(
    Schema.Array(Schema.Struct({ question: Schema.String, answer: OptionalText })),
  ),
  note: OptionalText,
  foundAt: OptionalText,
  appliedAt: OptionalText,
  followUpAt: OptionalText,
  interviewAt: OptionalText,
});
export type CareerApplication = typeof CareerApplication.Type;

export const CareerProfileItem = Schema.Literals([
  "careerRecord",
  "evidenceBank",
  "masterCv",
  "preferences",
]);
export type CareerProfileItem = typeof CareerProfileItem.Type;

export const CareerProfile = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  /** Each part of the profile, and whether it is in place. */
  items: Schema.Array(Schema.Struct({ item: CareerProfileItem, present: Schema.Boolean })),
  /** Preference fields still empty, such as `salaryFloor`. */
  missingPreferences: Schema.Array(Schema.String),
  sites: Schema.Array(Schema.String),
});
export type CareerProfile = typeof CareerProfile.Type;

/** Read from files on the environment's machine; no agent turn runs. */
export const CareerReport = Schema.Struct({
  /** Null until gs-jobs has written a profile. */
  profile: Schema.NullOr(CareerProfile),
  applications: Schema.Array(CareerApplication),
  /** The start of each ready application's `statement.md`, for the review screen. */
  previews: Schema.Array(Schema.Struct({ id: Schema.String, statement: Schema.String })),
});
export type CareerReport = typeof CareerReport.Type;
