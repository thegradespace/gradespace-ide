import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as Career from "./Career.ts";

const entry = { id: "a", title: "Analyst", employer: "ONS", status: "match" };

describe("careerApplications", () => {
  it("keeps valid entries and drops ones it cannot read", () => {
    const json = JSON.stringify({
      applications: [
        entry,
        { id: "b", title: "No employer", status: "match" },
        { ...entry, id: "c", status: "someday" },
      ],
    });
    expect(Career.careerApplications(json).map((application) => application.id)).toEqual(["a"]);
    expect(Career.careerApplications("not json")).toEqual([]);
  });
});

it.effect("reports the profile's parts and the applications from ~/.gradespace/career", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-career-" });
    const root = path.join(home, ".gradespace", "career");
    yield* fs.makeDirectory(root, { recursive: true });
    const record = path.join(home, "career-record.md");
    yield* fs.writeFileString(record, "# Record");
    yield* fs.writeFileString(
      path.join(root, "profile.json"),
      JSON.stringify({
        name: "Ada",
        sources: { careerRecord: record, evidenceBank: path.join(home, "missing.md") },
        preferences: { roles: ["Analyst"], locations: [], salaryFloor: null, sites: ["reed", 3] },
      }),
    );
    yield* fs.writeFileString(
      path.join(root, "applications.json"),
      JSON.stringify({
        applications: [
          entry,
          { ...entry, id: "ready", status: "ready" },
          { ...entry, id: "../escape", status: "ready" },
        ],
      }),
    );
    yield* fs.makeDirectory(path.join(root, "applications", "ready"), { recursive: true });
    yield* fs.writeFileString(
      path.join(root, "applications", "ready", "statement.md"),
      "I led it.",
    );
    yield* fs
      .writeFileString(path.join(root, "escape", "statement.md"), "outside")
      .pipe(Effect.ignore);

    const report = yield* Effect.gen(function* () {
      const career = yield* Career.Career;
      return yield* career.status;
    }).pipe(Effect.provide(Career.layer), Effect.provideService(HostProcess.HomeDirectory, home));

    expect(report.profile).toEqual({
      name: "Ada",
      items: [
        { item: "careerRecord", present: true },
        { item: "evidenceBank", present: false },
        { item: "masterCv", present: false },
        { item: "preferences", present: true },
      ],
      missingPreferences: ["locations", "salaryFloor", "workPattern"],
      sites: ["reed"],
    });
    expect(report.applications.map((application) => application.id)).toEqual([
      "a",
      "ready",
      "../escape",
    ]);
    expect(report.previews).toEqual([{ id: "ready", statement: "I led it." }]);

    const empty = yield* Effect.gen(function* () {
      const career = yield* Career.Career;
      return yield* career.status;
    }).pipe(
      Effect.provide(Career.layer),
      Effect.provideService(HostProcess.HomeDirectory, path.join(home, "nobody")),
    );
    expect(empty).toEqual({ profile: null, applications: [], previews: [] });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
