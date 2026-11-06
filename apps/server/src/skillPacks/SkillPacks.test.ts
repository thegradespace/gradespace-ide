// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  SKILL_PACK_MARKER_FILE,
  type SkillPackStatus,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SkillPacks from "./SkillPacks.ts";

const MANIFEST_URL = "https://skills.test/pack/manifest.json";

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** A tiny fake pack server: the manifest plus file bodies keyed by URL. */
const makePack = () => {
  const files = new Map<string, string>();
  let manifest: unknown = { version: 1, skills: [] };
  const requests: string[] = [];
  const publish = (
    name: string,
    version: string,
    contents: Record<string, string>,
    overrides: { readonly sha256?: string; readonly path?: string } = {},
  ) => {
    const entries = Object.entries(contents).map(([path, body]) => {
      const url = `files/${name}/${version}/${path}`;
      files.set(new URL(url, MANIFEST_URL).toString(), body);
      return {
        path: path === "SKILL.md" ? path : (overrides.path ?? path),
        url,
        sha256: overrides.sha256 ?? sha256(body),
        size: Buffer.byteLength(body),
      };
    });
    manifest = {
      version: 1,
      skills: [{ name, version, description: `${name} skill`, files: entries }],
    };
  };
  const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) => {
    requests.push(request.url);
    const body = request.url === MANIFEST_URL ? JSON.stringify(manifest) : files.get(request.url);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        body === undefined ? new Response("", { status: 404 }) : new Response(body),
      ),
    );
  });
  return { publish, requests, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const layerFor = (
  pack: ReturnType<typeof makePack>,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) =>
  SkillPacks.layer.pipe(
    Layer.provideMerge(
      ServerSettings.layerTest({ skillPackManifestUrl: MANIFEST_URL, ...settings }),
    ),
    Layer.provideMerge(pack.layer),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-skill-packs-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );

/** A temp home with Claude and Codex set up; never the real ~/.claude or ~/.codex. */
const withHome = <A, E, R>(
  body: (home: string) => Effect.Effect<A, E, R>,
  environment: (home: string) => NodeJS.ProcessEnv = () => ({}),
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-skill-packs-home-" });
    yield* fs.makeDirectory(path.join(home, ".claude"));
    yield* fs.makeDirectory(path.join(home, ".codex"));
    // An empty environment keeps a developer's own CLAUDE_CONFIG_DIR or CODEX_HOME out of reach.
    return yield* body(home).pipe(
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HostProcess.Environment, environment(home)),
    );
  }).pipe(Effect.scoped);

const states = (status: SkillPackStatus, name: string) =>
  status.skills
    .find((skill) => skill.name === name)
    ?.agents.map((agent) => `${agent.agent}:${agent.state}:${agent.installedVersion ?? "-"}`);

const read = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(file);
  });

const listSkills = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): string[] => []));
    return entries.toSorted();
  });

it.effect("installs, updates and removes a skill in every agent home", () => {
  const pack = makePack();
  return withHome((home) =>
    Effect.gen(function* () {
      const skills = yield* SkillPacks.SkillPacks;
      const path = yield* Path.Path;
      const claude = path.join(home, ".claude", "skills", "alpha");
      const codex = path.join(home, ".codex", "skills", "alpha");

      pack.publish("alpha", "1.0.0", { "SKILL.md": "v1", "assets/old.txt": "old" });
      expect(states(yield* skills.status, "alpha")).toEqual([
        "claude:notInstalled:-",
        "codex:notInstalled:-",
      ]);

      const installed = yield* skills.install(["alpha"]);
      expect(states(installed, "alpha")).toEqual([
        "claude:installed:1.0.0",
        "codex:installed:1.0.0",
      ]);
      expect(yield* read(path.join(codex, "assets", "old.txt"))).toBe("old");
      expect(yield* read(path.join(claude, SKILL_PACK_MARKER_FILE))).toContain(MANIFEST_URL);

      pack.publish("alpha", "2.0.0", { "SKILL.md": "v2" });
      expect(states(yield* skills.status, "alpha")).toEqual([
        "claude:updateAvailable:1.0.0",
        "codex:updateAvailable:1.0.0",
      ]);
      const updated = yield* skills.update(undefined);
      expect(states(updated, "alpha")).toEqual(["claude:installed:2.0.0", "codex:installed:2.0.0"]);
      expect(yield* read(path.join(claude, "SKILL.md"))).toBe("v2");
      expect(yield* listSkills(claude)).toEqual([SKILL_PACK_MARKER_FILE, "SKILL.md"]);
      expect(yield* listSkills(path.dirname(claude))).toEqual(["alpha"]);

      const removed = yield* skills.remove(["alpha"]);
      expect(states(removed, "alpha")).toEqual(["claude:notInstalled:-", "codex:notInstalled:-"]);
      expect(yield* listSkills(path.dirname(codex))).toEqual([]);
    }),
  ).pipe(Effect.provide(layerFor(pack)));
});

it.effect("installs into the homes the Claude and Codex providers are set to use", () => {
  const pack = makePack();
  return withHome(
    (home) =>
      Effect.gen(function* () {
        const skills = yield* SkillPacks.SkillPacks;
        const settings = yield* ServerSettings.ServerSettingsService;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const claudeHome = path.join(home, "claude-env");
        const codexHome = path.join(home, "codex-instance");
        yield* fs.makeDirectory(claudeHome);
        yield* fs.makeDirectory(codexHome);
        yield* settings.updateSettings({
          providerInstances: {
            [ProviderInstanceId.make("codex")]: {
              driver: ProviderDriverKind.make("codex"),
              config: { homePath: codexHome },
            },
          },
        });
        pack.publish("alpha", "1.0.0", { "SKILL.md": "v1" });

        const status = yield* skills.install(["alpha"]);

        expect(status.agents.map((agent) => agent.skillsDirectory)).toEqual([
          path.join(claudeHome, "skills"),
          path.join(codexHome, "skills"),
        ]);
        expect(yield* read(path.join(claudeHome, "skills", "alpha", "SKILL.md"))).toBe("v1");
        expect(yield* read(path.join(codexHome, "skills", "alpha", "SKILL.md"))).toBe("v1");
        expect(yield* listSkills(path.join(home, ".claude"))).toEqual([]);
      }),
    (home) => ({ CLAUDE_CONFIG_DIR: `${home}/claude-env`, CODEX_HOME: `${home}/ignored` }),
  ).pipe(Effect.provide(layerFor(pack)));
});

it.effect("rejects manifest paths that leave the skill folder before downloading", () => {
  const pack = makePack();
  return withHome((home) =>
    Effect.gen(function* () {
      const skills = yield* SkillPacks.SkillPacks;
      const path = yield* Path.Path;
      for (const unsafe of ["../escape.md", "/etc/escape.md", "a/../../b.md", "C:/x.md", "a\\b"]) {
        pack.publish("alpha", "1.0.0", { "SKILL.md": "v1", "x.md": "x" }, { path: unsafe });
        expect((yield* skills.status).manifestError).toBe(
          "The skill pack list is invalid, so nothing was installed.",
        );
        const error = yield* skills.install(["alpha"]).pipe(Effect.flip);
        expect(error.reason).toBe("invalidManifest");
      }
      expect(pack.requests.every((url) => url === MANIFEST_URL)).toBe(true);
      expect(yield* listSkills(path.join(home, ".claude", "skills"))).toEqual([]);
    }),
  ).pipe(Effect.provide(layerFor(pack)));
});

it.effect("a checksum mismatch leaves the installed skill as it was", () => {
  const pack = makePack();
  return withHome((home) =>
    Effect.gen(function* () {
      const skills = yield* SkillPacks.SkillPacks;
      const path = yield* Path.Path;
      const claude = path.join(home, ".claude", "skills", "alpha");
      pack.publish("alpha", "1.0.0", { "SKILL.md": "v1" });
      yield* skills.install(["alpha"]);

      pack.publish("alpha", "2.0.0", { "SKILL.md": "v2" }, { sha256: sha256("tampered") });
      const error = yield* skills.update(["alpha"]).pipe(Effect.flip);

      expect(error.reason).toBe("checksumMismatch");
      expect(yield* read(path.join(claude, "SKILL.md"))).toBe("v1");
      expect(yield* listSkills(path.dirname(claude))).toEqual(["alpha"]);
      expect(states(yield* skills.status, "alpha")).toEqual([
        "claude:updateAvailable:1.0.0",
        "codex:updateAvailable:1.0.0",
      ]);
    }),
  ).pipe(Effect.provide(layerFor(pack)));
});

it.effect("never changes folders it didn't install, including symlinks", () => {
  const pack = makePack();
  return withHome((home) =>
    Effect.gen(function* () {
      const skills = yield* SkillPacks.SkillPacks;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const claude = path.join(home, ".claude", "skills", "alpha");
      const codex = path.join(home, ".codex", "skills", "alpha");
      yield* fs.makeDirectory(claude, { recursive: true });
      yield* fs.writeFileString(path.join(claude, "SKILL.md"), "mine");
      // A checkout with our marker is still the user's when reached through a symlink.
      const checkout = path.join(home, "checkout", "alpha");
      yield* fs.makeDirectory(checkout, { recursive: true });
      yield* fs.writeFileString(path.join(checkout, "SKILL.md"), "repo");
      yield* fs.writeFileString(
        path.join(checkout, SKILL_PACK_MARKER_FILE),
        JSON.stringify({
          manifestUrl: MANIFEST_URL,
          name: "alpha",
          version: "0.1.0",
          installedAt: "",
        }),
      );
      yield* fs.makeDirectory(path.dirname(codex), { recursive: true });
      yield* fs.symlink(checkout, codex);

      pack.publish("alpha", "1.0.0", { "SKILL.md": "pack" });
      expect(states(yield* skills.install(["alpha"]), "alpha")).toEqual([
        "claude:outsideApp:-",
        "codex:outsideApp:-",
      ]);
      yield* skills.update(undefined);
      yield* skills.remove(["alpha"]);

      expect(yield* read(path.join(claude, "SKILL.md"))).toBe("mine");
      expect(yield* read(path.join(codex, "SKILL.md"))).toBe("repo");
      expect(yield* fs.readLink(codex)).toBe(checkout);
      expect(pack.requests.filter((url) => url !== MANIFEST_URL)).toEqual([]);
    }),
  ).pipe(Effect.provide(layerFor(pack)));
});

it.effect("updates on its own only when turned on, at most once a day", () => {
  const pack = makePack();
  return withHome((home) =>
    Effect.gen(function* () {
      const skills = yield* SkillPacks.SkillPacks;
      const settings = yield* ServerSettings.ServerSettingsService;
      const path = yield* Path.Path;
      pack.publish("alpha", "1.0.0", { "SKILL.md": "v1" });
      yield* skills.autoUpdate;
      expect(pack.requests).toEqual([]);

      yield* skills.install(["alpha"]);
      pack.publish("alpha", "2.0.0", { "SKILL.md": "v2" });
      yield* settings.updateSettings({ keepSkillsUpToDate: false });
      const before = pack.requests.length;
      yield* skills.autoUpdate;
      expect(pack.requests.length).toBe(before);

      yield* settings.updateSettings({ keepSkillsUpToDate: true });
      yield* skills.autoUpdate;
      expect(yield* read(path.join(home, ".codex", "skills", "alpha", "SKILL.md"))).toBe("v2");
      const afterFirst = pack.requests.length;
      yield* skills.autoUpdate;
      expect(pack.requests.length).toBe(afterFirst);
    }),
  ).pipe(Effect.provide(layerFor(pack)));
});
