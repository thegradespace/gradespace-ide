// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  SKILL_PACK_DEFAULT_MANIFEST_URL,
  SKILL_PACK_MARKER_FILE,
  SKILL_PACK_MAX_SKILL_BYTES,
  SKILL_PACK_MAX_SKILL_FILES,
  SkillPackError,
  SkillPackManifest,
  type SkillPackAgent,
  type SkillPackAgentHome,
  type SkillPackInstallState,
  type SkillPackManifestSkill,
  type SkillPackSkillStatus,
  type SkillPackStatus,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerConfig from "../config.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

const REQUEST_TIMEOUT = "30 seconds";
const AUTO_UPDATE_FIRST_CHECK_DELAY = "1 minute";
const AUTO_UPDATE_CHECK_INTERVAL = "1 hour";
const AUTO_UPDATE_MIN_GAP_MS = 24 * 60 * 60 * 1000;
const STAGING_PREFIX = ".gradespace-";

const AGENT_HOMES: ReadonlyArray<{ readonly agent: SkillPackAgent; readonly folder: string }> = [
  { agent: "claude", folder: ".claude" },
  { agent: "codex", folder: ".codex" },
];

const SkillMarker = Schema.Struct({
  manifestUrl: Schema.String,
  name: Schema.String,
  version: Schema.String,
  installedAt: Schema.String,
});
const decodeMarker = Schema.decodeUnknownEffect(Schema.fromJsonString(SkillMarker));
const encodeMarker = Schema.encodeEffect(Schema.fromJsonString(SkillMarker));
const decodeManifest = Schema.decodeUnknownEffect(SkillPackManifest);

const AutoUpdateState = Schema.Struct({ lastCheckedAt: Schema.Number });
const decodeAutoUpdateState = Schema.decodeUnknownEffect(Schema.fromJsonString(AutoUpdateState));
const encodeAutoUpdateState = Schema.encodeEffect(Schema.fromJsonString(AutoUpdateState));

const manifestUrlFromEnv = Config.String("GS_SKILL_PACK_MANIFEST_URL").pipe(Config.withDefault(""));

const UNSAFE_SEGMENT = /[<>:"|?*\\\u0000-\u001f]/u;

/** Relative, `/`-separated, and unable to leave the skill folder on any OS. */
const isSafeSkillFilePath = (path: string) => {
  if (path.length > 255 || path.startsWith("/")) return false;
  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !UNSAFE_SEGMENT.test(segment) &&
      !segment.endsWith(".") &&
      !segment.endsWith(" "),
  );
};

const isHttpUrl = (url: URL) => url.protocol === "https:" || url.protocol === "http:";

type ResolvedSkill = SkillPackManifestSkill & {
  readonly files: ReadonlyArray<
    SkillPackManifestSkill["files"][number] & { readonly href: string }
  >;
};

type Inspection =
  | { readonly kind: "missing" }
  | { readonly kind: "outside" }
  | { readonly kind: "ours"; readonly version: string };

type AgentHome = SkillPackAgentHome;

export class SkillPacks extends Context.Service<
  SkillPacks,
  {
    /** Never fails on the pack: an unreachable pack still lists installed skills so they can go. */
    readonly status: Effect.Effect<SkillPackStatus, SkillPackError>;
    /** Installs into every agent home on this machine, skipping folders the app didn't install. */
    readonly install: (
      names: ReadonlyArray<string>,
    ) => Effect.Effect<SkillPackStatus, SkillPackError>;
    /** Only touches folders the app installed. Without names, updates everything outdated. */
    readonly update: (
      names: ReadonlyArray<string> | undefined,
    ) => Effect.Effect<SkillPackStatus, SkillPackError>;
    readonly remove: (
      names: ReadonlyArray<string>,
    ) => Effect.Effect<SkillPackStatus, SkillPackError>;
    /** Runs the daily update when "Keep skills up to date" is on. Failures are logged. */
    readonly autoUpdate: Effect.Effect<void>;
  }
>()("t3/skillPacks/SkillPacks") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  const autoUpdateStatePath = path.join(config.stateDir, "skill-packs.json");

  const fail =
    (reason: SkillPackError["reason"], skill?: string) =>
    (cause?: unknown): SkillPackError =>
      new SkillPackError({
        reason,
        ...(skill === undefined ? {} : { skill }),
        ...(cause === undefined ? {} : { cause }),
      });

  const resolveManifestUrl = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(Effect.mapError(fail("unreachable")));
    const fromEnv = yield* manifestUrlFromEnv.pipe(Effect.orElseSucceed(() => ""));
    const raw = settings.skillPackManifestUrl || fromEnv || SKILL_PACK_DEFAULT_MANIFEST_URL;
    const url = yield* Effect.try({ try: () => new URL(raw), catch: fail("invalidManifest") });
    if (!isHttpUrl(url)) return yield* fail("invalidManifest")();
    return { url: url.toString(), offline: settings.offlineMode };
  });

  const homes = Effect.gen(function* () {
    const home = yield* HostProcess.HomeDirectory;
    return yield* Effect.forEach(AGENT_HOMES, ({ agent, folder }) =>
      fs.exists(path.join(home, folder)).pipe(
        Effect.orElseSucceed(() => false),
        Effect.map((available): AgentHome => ({
          agent,
          skillsDirectory: path.join(home, folder, "skills"),
          available,
        })),
      ),
    );
  });

  const validateManifest = Effect.fn("SkillPacks.validateManifest")(function* (
    manifest: SkillPackManifest,
    manifestUrl: string,
  ) {
    const invalid = (skill?: string) => fail("invalidManifest", skill)();
    const names = new Set<string>();
    const skills: ResolvedSkill[] = [];
    for (const skill of manifest.skills) {
      const key = skill.name.toLowerCase();
      if (names.has(key)) return yield* invalid(skill.name);
      names.add(key);
      const paths = new Set<string>();
      const files = [];
      for (const file of skill.files) {
        const pathKey = file.path.toLowerCase();
        if (!isSafeSkillFilePath(file.path) || pathKey === SKILL_PACK_MARKER_FILE) {
          return yield* invalid(skill.name);
        }
        if (paths.has(pathKey)) return yield* invalid(skill.name);
        paths.add(pathKey);
        const href = yield* Effect.try({
          try: () => new URL(file.url, manifestUrl),
          catch: () => invalid(skill.name),
        });
        if (!isHttpUrl(href)) return yield* invalid(skill.name);
        files.push({ ...file, href: href.toString() });
      }
      if (!paths.has("skill.md")) return yield* invalid(skill.name);
      skills.push({ ...skill, files });
    }
    return skills;
  });

  const send = (url: string, error: (cause: unknown) => SkillPackError) =>
    httpClient.execute(HttpClientRequest.get(url)).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(error),
      Effect.filterOrFail(
        (response) => response.status === 200,
        (response) => error(new Error(`The server answered ${response.status}.`)),
      ),
    );

  const fetchManifest = Effect.gen(function* () {
    const { url, offline } = yield* resolveManifestUrl;
    if (offline) return yield* fail("offline")();
    const response = yield* send(url, fail("unreachable"));
    const manifest = yield* response.json.pipe(
      Effect.flatMap(decodeManifest),
      Effect.mapError(fail("invalidManifest")),
    );
    return { url, skills: yield* validateManifest(manifest, url) };
  }).pipe(Effect.withSpan("SkillPacks.fetchManifest"));

  const isSymlink = (target: string) =>
    fs.readLink(target).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  // Untraced: called per folder per agent, always inside a traced operation.
  const inspect = Effect.fnUntraced(function* (skillsDirectory: string, name: string) {
    const target = path.join(skillsDirectory, name);
    if (yield* isSymlink(target)) return { kind: "outside" } satisfies Inspection;
    if (!(yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false)))) {
      return { kind: "missing" } satisfies Inspection;
    }
    return yield* fs.readFileString(path.join(target, SKILL_PACK_MARKER_FILE)).pipe(
      Effect.flatMap(decodeMarker),
      Effect.map((marker): Inspection => ({ kind: "ours", version: marker.version })),
      Effect.orElseSucceed((): Inspection => ({ kind: "outside" })),
    );
  });

  const installedNames = (home: AgentHome) =>
    fs.readDirectory(home.skillsDirectory).pipe(
      Effect.orElseSucceed((): string[] => []),
      Effect.map((entries) => entries.filter((entry) => !entry.startsWith("."))),
      Effect.flatMap((entries) =>
        Effect.filter(entries, (name) =>
          inspect(home.skillsDirectory, name).pipe(Effect.map((found) => found.kind === "ours")),
        ),
      ),
    );

  const buildStatus = Effect.fn("SkillPacks.buildStatus")(function* (
    manifestUrl: string,
    pack: ReadonlyArray<ResolvedSkill> | null,
    manifestError: string | null,
  ) {
    const agentHomes = yield* homes;
    const available = agentHomes.filter((home) => home.available);
    const packNames = new Set(pack?.map((skill) => skill.name) ?? []);
    const extra = new Set<string>();
    for (const home of available) {
      for (const name of yield* installedNames(home)) {
        if (!packNames.has(name)) extra.add(name);
      }
    }
    const candidates = [
      ...(pack ?? []).map((skill) => ({
        name: skill.name,
        description: skill.description,
        latestVersion: skill.version as string | null,
      })),
      ...[...extra].toSorted().map((name) => ({ name, description: "", latestVersion: null })),
    ];
    const skills = yield* Effect.forEach(
      candidates,
      (candidate): Effect.Effect<SkillPackSkillStatus> =>
        Effect.forEach(available, (home) =>
          inspect(home.skillsDirectory, candidate.name).pipe(
            Effect.map((found) => {
              const state: SkillPackInstallState =
                found.kind === "missing"
                  ? "notInstalled"
                  : found.kind === "outside"
                    ? "outsideApp"
                    : candidate.latestVersion !== null && found.version !== candidate.latestVersion
                      ? "updateAvailable"
                      : "installed";
              return {
                agent: home.agent,
                state,
                installedVersion: found.kind === "ours" ? found.version : null,
              };
            }),
          ),
        ).pipe(Effect.map((agents) => ({ ...candidate, agents }))),
    );
    return { manifestUrl, manifestError, agents: agentHomes, skills } satisfies SkillPackStatus;
  });

  const statusAfter = (manifest: { readonly url: string; readonly skills: ResolvedSkill[] }) =>
    buildStatus(manifest.url, manifest.skills, null);

  const status: SkillPacks["Service"]["status"] = Effect.gen(function* () {
    const { url } = yield* resolveManifestUrl;
    return yield* fetchManifest.pipe(
      Effect.flatMap(statusAfter),
      Effect.catch((error) => buildStatus(url, null, error.message)),
    );
  }).pipe(Effect.withSpan("SkillPacks.status"));

  const download = Effect.fn("SkillPacks.download")(function* (skill: ResolvedSkill) {
    const total = skill.files.reduce((sum, file) => sum + file.size, 0);
    if (skill.files.length > SKILL_PACK_MAX_SKILL_FILES || total > SKILL_PACK_MAX_SKILL_BYTES) {
      return yield* fail("tooLarge", skill.name)();
    }
    return yield* Effect.forEach(
      skill.files,
      (file) =>
        Effect.gen(function* () {
          const response = yield* send(file.href, fail("downloadFailed", skill.name));
          const declared = Number(response.headers["content-length"] ?? Number.NaN);
          if (declared > file.size) return yield* fail("checksumMismatch", skill.name)();
          const bytes = new Uint8Array(
            yield* response.arrayBuffer.pipe(Effect.mapError(fail("downloadFailed", skill.name))),
          );
          const digest = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
          if (bytes.byteLength !== file.size || digest !== file.sha256.toLowerCase()) {
            return yield* fail("checksumMismatch", skill.name)();
          }
          return { path: file.path, bytes };
        }),
      { concurrency: 4 },
    );
  });

  /** Stages beside the target so the final swap is a same-volume rename. */
  const writeSkill = Effect.fn("SkillPacks.writeSkill")(function* (
    home: AgentHome,
    skill: ResolvedSkill,
    files: ReadonlyArray<{ readonly path: string; readonly bytes: Uint8Array }>,
    manifestUrl: string,
  ) {
    const target = path.join(home.skillsDirectory, skill.name);
    const suffix = `${skill.name}-${NodeCrypto.randomUUID().slice(0, 8)}`;
    const staging = path.join(home.skillsDirectory, `${STAGING_PREFIX}staging-${suffix}`);
    const previous = path.join(home.skillsDirectory, `${STAGING_PREFIX}old-${suffix}`);
    const write = Effect.gen(function* () {
      yield* fs.makeDirectory(staging, { recursive: true });
      for (const file of files) {
        const destination = path.join(staging, ...file.path.split("/"));
        yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fs.writeFile(destination, file.bytes);
      }
      const marker = yield* encodeMarker({
        manifestUrl,
        name: skill.name,
        version: skill.version,
        installedAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
      });
      yield* fs.writeFileString(path.join(staging, SKILL_PACK_MARKER_FILE), `${marker}\n`);
      // Checked again right before the swap: a folder that appeared meanwhile stays untouched.
      const current = yield* inspect(home.skillsDirectory, skill.name);
      if (current.kind === "outside") return;
      if (current.kind === "missing") {
        yield* fs.rename(staging, target);
        return;
      }
      yield* fs.rename(target, previous);
      yield* fs
        .rename(staging, target)
        .pipe(Effect.tapError(() => fs.rename(previous, target).pipe(Effect.ignore)));
      yield* fs.remove(previous, { recursive: true }).pipe(Effect.ignore);
    });
    yield* write.pipe(
      Effect.mapError(fail("writeFailed", skill.name)),
      Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
    );
  });

  const availableHomes = Effect.gen(function* () {
    const available = (yield* homes).filter((home) => home.available);
    if (available.length === 0) return yield* fail("noAgents")();
    return available;
  });

  const pick = (skills: ReadonlyArray<ResolvedSkill>, names: ReadonlyArray<string>) =>
    Effect.forEach(names, (name) => {
      const skill = skills.find((candidate) => candidate.name === name);
      return skill === undefined
        ? Effect.fail(fail("unknownSkill", name)())
        : Effect.succeed(skill);
    });

  /** Downloads every skill before writing any, so one bad file changes nothing. */
  const apply = Effect.fn("SkillPacks.apply")(function* (
    manifestUrl: string,
    plan: ReadonlyArray<{
      readonly skill: ResolvedSkill;
      readonly homes: ReadonlyArray<AgentHome>;
    }>,
  ) {
    const writable = plan.filter((entry) => entry.homes.length > 0);
    const downloaded = yield* Effect.forEach(writable, ({ skill, homes }) =>
      download(skill).pipe(Effect.map((files) => ({ skill, homes, files }))),
    );
    for (const { skill, homes, files } of downloaded) {
      for (const home of homes) {
        yield* fs
          .makeDirectory(home.skillsDirectory, { recursive: true })
          .pipe(Effect.mapError(fail("writeFailed", skill.name)));
        yield* writeSkill(home, skill, files, manifestUrl);
      }
    }
  });

  const install: SkillPacks["Service"]["install"] = Effect.fn("SkillPacks.install")(function* (
    names,
  ) {
    const manifest = yield* fetchManifest;
    const skills = yield* pick(manifest.skills, names);
    const targets = yield* availableHomes;
    const plan = yield* Effect.forEach(skills, (skill) =>
      Effect.filter(targets, (home) =>
        inspect(home.skillsDirectory, skill.name).pipe(
          Effect.map((found) => found.kind !== "outside"),
        ),
      ).pipe(Effect.map((homes) => ({ skill, homes }))),
    );
    yield* apply(manifest.url, plan);
    return yield* statusAfter(manifest);
  }, lock.withPermits(1));

  const outdated = Effect.fn("SkillPacks.outdated")(function* (
    skills: ReadonlyArray<ResolvedSkill>,
  ) {
    const targets = (yield* homes).filter((home) => home.available);
    return yield* Effect.forEach(skills, (skill) =>
      Effect.filter(targets, (home) =>
        inspect(home.skillsDirectory, skill.name).pipe(
          Effect.map((found) => found.kind === "ours" && found.version !== skill.version),
        ),
      ).pipe(Effect.map((homes) => ({ skill, homes }))),
    );
  });

  const update: SkillPacks["Service"]["update"] = Effect.fn("SkillPacks.update")(function* (names) {
    const manifest = yield* fetchManifest;
    const skills = names === undefined ? manifest.skills : yield* pick(manifest.skills, names);
    const plan = (yield* outdated(skills)).filter((entry) => entry.homes.length > 0);
    yield* apply(manifest.url, plan);
    return yield* statusAfter(manifest);
  }, lock.withPermits(1));

  const remove: SkillPacks["Service"]["remove"] = Effect.fn("SkillPacks.remove")(function* (names) {
    const targets = (yield* homes).filter((home) => home.available);
    for (const name of names) {
      for (const home of targets) {
        if ((yield* inspect(home.skillsDirectory, name)).kind !== "ours") continue;
        yield* fs
          .remove(path.join(home.skillsDirectory, name), { recursive: true })
          .pipe(Effect.mapError(fail("writeFailed", name)));
      }
    }
    return yield* status;
  }, lock.withPermits(1));

  const autoUpdate: SkillPacks["Service"]["autoUpdate"] = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    if (!settings.keepSkillsUpToDate || settings.offlineMode) return;
    const now = yield* Clock.currentTimeMillis;
    const last = yield* fs.readFileString(autoUpdateStatePath).pipe(
      Effect.flatMap(decodeAutoUpdateState),
      Effect.map((state) => state.lastCheckedAt),
      Effect.orElseSucceed(() => null),
    );
    if (last !== null && now - last < AUTO_UPDATE_MIN_GAP_MS) return;
    // Users without app-installed skills never reach the network from here.
    const targets = (yield* homes).filter((home) => home.available);
    const installed = yield* Effect.forEach(targets, installedNames);
    if (installed.every((names) => names.length === 0)) return;
    yield* fs.writeFileString(
      autoUpdateStatePath,
      yield* encodeAutoUpdateState({ lastCheckedAt: now }),
    );
    yield* update(undefined);
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Skill pack update check failed.", { cause })),
    Effect.withSpan("SkillPacks.autoUpdate"),
  );

  yield* forkParked(
    Effect.sleep(AUTO_UPDATE_FIRST_CHECK_DELAY).pipe(
      Effect.andThen(autoUpdate.pipe(Effect.repeat(Schedule.spaced(AUTO_UPDATE_CHECK_INTERVAL)))),
    ),
  );

  return SkillPacks.of({ status, install, update, remove, autoUpdate });
});

export const layer = Layer.effect(SkillPacks, make);
