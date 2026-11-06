import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SKILL_PACK_DEFAULT_MANIFEST_URL = "https://thegradespace.com/ide/skills/manifest.json";
export const SKILL_PACK_MAX_SKILL_BYTES = 20 * 1024 * 1024;
export const SKILL_PACK_MAX_SKILL_FILES = 200;
/** Written into every folder the app installs; folders without it are never changed. */
export const SKILL_PACK_MARKER_FILE = ".gradespace-skill.json";

/** One path segment: no separators, dots-only names, or characters Windows refuses. */
export const SkillPackSkillName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
);
export type SkillPackSkillName = typeof SkillPackSkillName.Type;

export const SkillPackFile = Schema.Struct({
  /** Relative to the skill folder, with `/` separators. The server rejects anything that escapes. */
  path: TrimmedNonEmptyString,
  /** Absolute, or relative to the manifest URL. */
  url: TrimmedNonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{64}$/u)),
  size: NonNegativeInt,
});
export type SkillPackFile = typeof SkillPackFile.Type;

export const SkillPackManifestSkill = Schema.Struct({
  name: SkillPackSkillName,
  version: TrimmedNonEmptyString,
  description: Schema.String,
  files: Schema.Array(SkillPackFile),
});
export type SkillPackManifestSkill = typeof SkillPackManifestSkill.Type;

export const SkillPackManifest = Schema.Struct({
  version: Schema.Literal(1),
  skills: Schema.Array(SkillPackManifestSkill),
});
export type SkillPackManifest = typeof SkillPackManifest.Type;

export const SkillPackAgent = Schema.Literals(["claude", "codex"]);
export type SkillPackAgent = typeof SkillPackAgent.Type;

export const SkillPackAgentHome = Schema.Struct({
  agent: SkillPackAgent,
  skillsDirectory: Schema.String,
  /** False when the agent's home folder doesn't exist on this machine. */
  available: Schema.Boolean,
});
export type SkillPackAgentHome = typeof SkillPackAgentHome.Type;

export const SkillPackInstallState = Schema.Literals([
  "notInstalled",
  "installed",
  "updateAvailable",
  /** A folder of that name the app didn't install, or a symlink. Never touched. */
  "outsideApp",
]);
export type SkillPackInstallState = typeof SkillPackInstallState.Type;

export const SkillPackSkillStatus = Schema.Struct({
  name: SkillPackSkillName,
  description: Schema.String,
  /** Null when the skill isn't in the pack, or the pack couldn't be loaded. */
  latestVersion: Schema.NullOr(Schema.String),
  agents: Schema.Array(
    Schema.Struct({
      agent: SkillPackAgent,
      state: SkillPackInstallState,
      installedVersion: Schema.NullOr(Schema.String),
    }),
  ),
});
export type SkillPackSkillStatus = typeof SkillPackSkillStatus.Type;

export const SkillPackStatus = Schema.Struct({
  manifestUrl: Schema.String,
  /** Why the pack couldn't be loaded. Installed skills are still listed so they can be removed. */
  manifestError: Schema.NullOr(Schema.String),
  agents: Schema.Array(SkillPackAgentHome),
  skills: Schema.Array(SkillPackSkillStatus),
});
export type SkillPackStatus = typeof SkillPackStatus.Type;

export const SkillPackNamesInput = Schema.Struct({
  names: Schema.Array(SkillPackSkillName).check(Schema.isMinLength(1)),
});
export type SkillPackNamesInput = typeof SkillPackNamesInput.Type;

export const SkillPackUpdateInput = Schema.Struct({
  /** Absent updates every installed skill with a newer version. */
  names: Schema.optional(Schema.Array(SkillPackSkillName)),
});
export type SkillPackUpdateInput = typeof SkillPackUpdateInput.Type;

export class SkillPackError extends Schema.TaggedError<SkillPackError>()("SkillPackError", {
  reason: Schema.Literals([
    "offline",
    "unreachable",
    "invalidManifest",
    "unknownSkill",
    "noAgents",
    "downloadFailed",
    "checksumMismatch",
    "tooLarge",
    "writeFailed",
  ]),
  skill: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const subject = this.skill === undefined ? "" : ` (${this.skill})`;
    switch (this.reason) {
      case "offline":
        return "Offline mode is on. Turn it off in Settings to install or update skills.";
      case "unreachable":
        return "The Gradespace skill pack isn't available right now.";
      case "invalidManifest":
        return "The skill pack list is invalid, so nothing was installed.";
      case "unknownSkill":
        return `That skill isn't in the skill pack${subject}.`;
      case "noAgents":
        return "Neither Claude nor Codex is set up on this machine.";
      case "downloadFailed":
        return `A skill file couldn't be downloaded${subject}.`;
      case "checksumMismatch":
        return `A downloaded skill file didn't match its checksum, so nothing was changed${subject}.`;
      case "tooLarge":
        return `This skill is too large to install${subject}.`;
      case "writeFailed":
        return `The skill couldn't be written to disk${subject}.`;
    }
  }
}
