import type { CareerApplication } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { careerHome, careerProfileRows, careerPrompt, statementSegments } from "./career.ts";

const application = (
  id: string,
  status: CareerApplication["status"],
  fields: Partial<CareerApplication> = {},
): CareerApplication => ({ id, title: id, employer: "Employer", status, ...fields });

describe("careerHome", () => {
  it("orders the queue and matches, drops closed adverts and finds due follow-ups", () => {
    const home = careerHome(
      {
        profile: null,
        previews: [],
        applications: [
          application("late", "ready", { closingDate: "2026-11-20" }),
          application("soon", "ready", { closingDate: "2026-11-10" }),
          application("closed", "ready", { closingDate: "2026-11-01" }),
          application("weak", "match", { score: 40 }),
          application("strong", "match", { score: 90 }),
          application("due", "applied", { followUpAt: "2026-11-08" }),
          application("waiting", "applied", { followUpAt: "2026-11-20" }),
          application("panel", "interview", { interviewAt: "2026-11-12" }),
        ],
      },
      "2026-11-08",
    );
    expect(home.ready.map((entry) => entry.id)).toEqual(["soon", "late"]);
    expect(home.matches.map((entry) => entry.id)).toEqual(["strong", "weak"]);
    expect(home.applied).toBe(2);
    expect(home.followUpsDue.map((entry) => entry.id)).toEqual(["due"]);
    expect(home.interviews.map((entry) => entry.id)).toEqual(["panel"]);
  });
});

it("marks preferences partial while fields are missing", () => {
  const rows = careerProfileRows({
    name: null,
    items: [
      { item: "careerRecord", present: true },
      { item: "masterCv", present: false },
      { item: "preferences", present: true },
    ],
    missingPreferences: ["salaryFloor"],
    sites: [],
  });
  expect(rows.map((row) => [row.item, row.state, row.detail])).toEqual([
    ["careerRecord", "ready", null],
    ["masterCv", "missing", null],
    ["preferences", "partial", "add salary floor"],
  ]);
});

it("starts Career chats with gs-jobs only when it is installed", () => {
  expect(careerPrompt({ kind: "submit", id: "a" }, true)).toBe("$gs-jobs Submit application a");
  expect(careerPrompt({ kind: "findMatches" }, false)).toBe("Find new matches.");
});

it("highlights the sentence before each evidence marker", () => {
  expect(
    statementSegments(
      "I want this role. I **led** a review of 40 evaluations.<!-- evidence: Royal Society --> Thanks.",
    ),
  ).toEqual([
    { text: "I want this role.", evidence: null },
    { text: " I led a review of 40 evaluations.", evidence: "Royal Society" },
    { text: " Thanks.", evidence: null },
  ]);
  expect(statementSegments("Hello.\n\nI built it. <!-- evidence: A --> Next.")).toEqual([
    { text: "Hello.\n\n", evidence: null },
    { text: "I built it. ", evidence: "A" },
    { text: " Next.", evidence: null },
  ]);
});
