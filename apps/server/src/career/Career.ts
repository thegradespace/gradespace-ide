import {
  CareerApplication,
  type CareerProfile,
  type CareerProfileItem,
  type CareerReport,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
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

export class Career extends Context.Service<
  Career,
  {
    /** Never fails: missing or unreadable files read as no profile and no applications. */
    readonly status: Effect.Effect<CareerReport>;
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
        /^[\w.-]+$/u.test(application.id) && !application.id.startsWith(".")
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

  return Career.of({ status });
});

export const layer = Layer.effect(Career, make);
