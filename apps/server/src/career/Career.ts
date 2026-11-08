import {
  CareerApplication,
  type CareerAnswersInput,
  CareerError,
  type CareerProfile,
  type CareerProfileItem,
  type CareerReport,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const OptionalPath = Schema.optional(Schema.NullOr(Schema.String));

const ProfileFile = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.optional(Schema.NullOr(Schema.String)),
    sources: Schema.optional(
      Schema.Struct({
        careerRecord: OptionalPath,
        evidenceBank: OptionalPath,
        masterCv: OptionalPath,
      }),
    ),
    preferences: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  }),
);
const decodeProfileFile = Schema.decodeUnknownOption(ProfileFile);

const ApplicationsFile = Schema.fromJsonString(
  Schema.Struct({ applications: Schema.Array(Schema.Unknown) }),
);
const decodeApplicationsFile = Schema.decodeUnknownOption(ApplicationsFile);
const decodeApplication = Schema.decodeUnknownOption(CareerApplication);

const PREVIEW_LIMIT = 4000;

const PREFERENCE_KEYS = ["roles", "locations", "salaryFloor", "workPattern", "sites"] as const;

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

/**
 * The applications gs-jobs wrote. An entry a newer skill shaped differently is dropped
 * rather than hiding the rest.
 */
export function careerApplications(json: string): ReadonlyArray<CareerApplication> {
  const parsed = decodeApplicationsFile(json);
  if (Option.isNone(parsed)) return [];
  return parsed.value.applications.flatMap((entry) => {
    const application = decodeApplication(entry);
    return Option.isSome(application) ? [application.value] : [];
  });
}

type JsonObject = { [key: string]: unknown };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseObject = (text: string): JsonObject | null => {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
};

const sameQuestion = (left: unknown, right: string) =>
  typeof left === "string" && left.trim().toLowerCase() === right.trim().toLowerCase();

/** Replaces or adds each answer in a list of `{ question, answer, ... }` objects. */
function upsertAnswers(
  list: unknown,
  answers: ReadonlyArray<{ question: string; answer: string }>,
  extra: JsonObject,
): JsonObject[] {
  const next = (Array.isArray(list) ? list : []).filter(isObject);
  for (const { question, answer } of answers) {
    const index = next.findIndex((item) => sameQuestion(item.question, question));
    const entry = { ...(index >= 0 ? next[index] : {}), question, answer, ...extra };
    if (index >= 0) next[index] = entry;
    else next.push(entry);
  }
  return next;
}

/**
 * The files after the user answers an application's questions. Unknown fields the skill wrote
 * are kept. Null when the application isn't in the file.
 */
export function applyCareerAnswers(
  files: { applications: string; answers: string | null; profile: string | null },
  input: CareerAnswersInput,
  /** ISO timestamp; its date part is the answer date. */
  now: string,
): { applications: string; answers: string; profile: string | null } | null {
  const today = now.slice(0, 10);
  const document = parseObject(files.applications);
  const list = Array.isArray(document?.applications) ? document.applications : null;
  const entry = list?.find((item): item is JsonObject => isObject(item) && item.id === input.id);
  if (!document || !entry) return null;
  const answered = input.answers.filter((item) => item.answer.trim() !== "");
  if (Array.isArray(entry.needsYou)) {
    entry.needsYou = entry.needsYou.filter(
      (item) =>
        !isObject(item) || !answered.some((answer) => sameQuestion(item.question, answer.question)),
    );
  }
  // gs-jobs folds answers newer than its last polish into the documents before it submits.
  entry.answersUpdatedAt = today;
  document.updatedAt = now;

  let previous: unknown = [];
  try {
    previous = files.answers ? JSON.parse(files.answers) : [];
  } catch {
    previous = [];
  }
  const answers = upsertAnswers(previous, answered, { source: "you", answeredAt: today });

  const remembered = answered.filter((item) => item.remember);
  let profile = files.profile;
  const profileDocument = files.profile ? parseObject(files.profile) : null;
  if (remembered.length > 0 && profileDocument) {
    profileDocument.standardAnswers = upsertAnswers(
      profileDocument.standardAnswers,
      remembered,
      {},
    );
    profile = `${JSON.stringify(profileDocument, null, 2)}\n`;
  }
  return {
    applications: `${JSON.stringify(document, null, 2)}\n`,
    answers: `${JSON.stringify(answers, null, 2)}\n`,
    profile,
  };
}

const isSafeId = (id: string) => /^[\w.-]+$/u.test(id) && !id.startsWith(".");

export class Career extends Context.Service<
  Career,
  {
    /** Never fails: missing or unreadable files read as no profile and no applications. */
    readonly status: Effect.Effect<CareerReport>;
    /** Saves answers to one application's questions, and remembered ones to the profile. */
    readonly answer: (input: CareerAnswersInput) => Effect.Effect<CareerReport, CareerError>;
  }
>()("t3/career/Career") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readText = (file: string) => fs.readFileString(file).pipe(Effect.option);
  const exists = (file: string | null | undefined) =>
    file ? fs.exists(file).pipe(Effect.orElseSucceed(() => false)) : Effect.succeed(false);

  const status = Effect.gen(function* () {
    const home = yield* HostProcess.HomeDirectory;
    // Beside ~/.gradespace/styles, outside the app's data home, so every install shares it.
    const root = path.join(home, ".gradespace", "career");
    const profileText = yield* readText(path.join(root, "profile.json"));
    const applicationsText = yield* readText(path.join(root, "applications.json"));

    let profile: CareerProfile | null = null;
    const parsed = Option.flatMap(profileText, decodeProfileFile);
    if (Option.isSome(parsed)) {
      const { name, sources, preferences } = parsed.value;
      const files: ReadonlyArray<[CareerProfileItem, string | null | undefined]> = [
        ["careerRecord", sources?.careerRecord],
        ["evidenceBank", sources?.evidenceBank],
        ["masterCv", sources?.masterCv],
      ];
      const items = yield* Effect.forEach(files, ([item, file]) =>
        exists(file).pipe(Effect.map((present) => ({ item, present }))),
      );
      const missingPreferences = PREFERENCE_KEYS.filter((key) => isEmpty(preferences?.[key]));
      const sites = preferences?.sites;
      profile = {
        name: name ?? null,
        items: [
          ...items,
          { item: "preferences", present: missingPreferences.length < PREFERENCE_KEYS.length },
        ],
        missingPreferences,
        sites: Array.isArray(sites) ? sites.filter((site) => typeof site === "string") : [],
      };
    }

    const applications = Option.match(applicationsText, {
      onNone: () => [],
      onSome: careerApplications,
    });
    const previews = yield* Effect.forEach(
      applications.filter((application) => application.status === "ready"),
      (application) =>
        // An id is a folder name the skill chose; never let one climb out of the folder.
        isSafeId(application.id)
          ? readText(path.join(root, "applications", application.id, "statement.md")).pipe(
              Effect.map(
                Option.map((statement) => ({
                  id: application.id,
                  statement: statement.slice(0, PREVIEW_LIMIT),
                })),
              ),
            )
          : Effect.succeedNone,
    );
    return { profile, applications, previews: previews.flatMap(Option.toArray) };
  }).pipe(Effect.withSpan("Career.status"));

  const answer = Effect.fn("Career.answer")(function* (input: CareerAnswersInput) {
    if (!isSafeId(input.id)) return yield* new CareerError({ reason: "unknownApplication" });
    const home = yield* HostProcess.HomeDirectory;
    const root = path.join(home, ".gradespace", "career");
    const folder = path.join(root, "applications", input.id);
    const applicationsText = yield* readText(path.join(root, "applications.json"));
    if (Option.isNone(applicationsText)) {
      return yield* new CareerError({ reason: "unreadable" });
    }
    const answersText = yield* readText(path.join(folder, "answers.json"));
    const profileText = yield* readText(path.join(root, "profile.json"));
    const next = applyCareerAnswers(
      {
        applications: applicationsText.value,
        answers: Option.getOrNull(answersText),
        profile: Option.getOrNull(profileText),
      },
      input,
      DateTime.formatIso(yield* DateTime.now),
    );
    if (next === null) return yield* new CareerError({ reason: "unknownApplication" });
    // Write beside and rename, so gs-jobs never reads a half-written file.
    const write = (file: string, contents: string) =>
      fs
        .writeFileString(`${file}.tmp`, contents)
        .pipe(Effect.andThen(fs.rename(`${file}.tmp`, file)));
    yield* Effect.all([
      fs.makeDirectory(folder, { recursive: true }),
      write(path.join(folder, "answers.json"), next.answers),
      ...(next.profile !== null && next.profile !== Option.getOrNull(profileText)
        ? [write(path.join(root, "profile.json"), next.profile)]
        : []),
      write(path.join(root, "applications.json"), next.applications),
    ]).pipe(Effect.mapError(() => new CareerError({ reason: "writeFailed" })));
    return yield* status;
  });

  return Career.of({ status, answer });
});

export const layer = Layer.effect(Career, make);
