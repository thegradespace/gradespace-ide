import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Digest from "effect/crypto/Digest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ClaudeInstallation from "./ClaudeInstallation.ts";

const VERSION = "2.1.318";
const BASE = ClaudeInstallation.CLAUDE_RELEASES_BASE_URL;
const binary = new TextEncoder().encode(`#!/bin/sh\nprintf '%s\\n' '${VERSION} (Claude Code)'\n`);

const makeHarness = Effect.fn("test.makeClaudeInstallation")(function* (
  input: {
    latest?: string;
    checksum?: string;
    manifestPlatform?: string;
    body?: Stream.Stream<Uint8Array>;
    baseDir?: string;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const digest = yield* Digest.Digest;
  const baseDir =
    input.baseDir ?? (yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-install-test-" }));
  const sha256 = Hex.encode(yield* digest.digest(Digest.sha256, binary).pipe(Effect.orDie));
  const manifest = JSON.stringify({
    version: VERSION,
    platforms: {
      [input.manifestPlatform ?? "darwin-arm64"]: {
        binary: "claude",
        checksum: input.checksum ?? sha256,
        size: binary.length,
      },
    },
  });
  const requests: string[] = [];
  const installation = yield* ClaudeInstallation.makeClaudeInstallation({
    baseDir,
    releasePlatform: "darwin-arm64",
  }).pipe(
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provideService(HostProcess.Architecture, "arm64"),
    Effect.provideService(HostProcess.Environment, { PATH: "" }),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request.url);
          if (request.url === `${BASE}/latest`)
            return HttpClientResponse.fromWeb(
              request,
              new Response(input.latest ?? `${VERSION}\n`),
            );
          if (request.url === `${BASE}/${VERSION}/manifest.json`)
            return HttpClientResponse.fromWeb(request, new Response(manifest));
          if (request.url === `${BASE}/${VERSION}/darwin-arm64/claude`)
            return Object.defineProperty(
              HttpClientResponse.fromWeb(request, new Response(null)),
              "stream",
              { value: input.body ?? Stream.succeed(binary) },
            );
          return HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }));
        }),
      ),
    ),
  );
  const executablePath = `${installation.managedDirectory}/bin/claude`;
  return { installation, fs, baseDir, executablePath, requests };
});

const terminalState = (installation: ClaudeInstallation.ClaudeInstallation["Service"]) =>
  installation.changes.pipe(
    Stream.filter((state) => ["succeeded", "failed", "cancelled"].includes(state.phase)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.each([
  [{ platform: "darwin", arch: "arm64" }, "darwin-arm64"],
  [{ platform: "darwin", arch: "x64" }, "darwin-x64"],
  [{ platform: "darwin", arch: "x64", rosetta: true }, "darwin-arm64"],
  [{ platform: "linux", arch: "x64" }, "linux-x64"],
  [{ platform: "linux", arch: "arm64", musl: true }, "linux-arm64-musl"],
  [{ platform: "win32", arch: "x64" }, "win32-x64"],
  [{ platform: "win32", arch: "arm64" }, "win32-arm64"],
  [{ platform: "win32", arch: "x64", processorArchitecture: "ARM64" }, "win32-arm64"],
  [{ platform: "win32", arch: "ia32" }, null],
  [{ platform: "linux", arch: "ia32" }, null],
  [{ platform: "freebsd", arch: "x64" }, null],
] as const)("maps %j to the official release platform %s", (input, expected) => {
  expect(ClaudeInstallation.resolveClaudeReleasePlatform(input)).toBe(expected);
});

it.effect("installs the verified release into the managed directory and removes it", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness();
    expect(yield* h.installation.start).toMatchObject({ phase: "downloading", version: null });
    expect(yield* terminalState(h.installation)).toMatchObject({
      phase: "succeeded",
      source: "managed",
      version: VERSION,
      installedVersion: VERSION,
      totalBytes: binary.length,
      executablePath: h.executablePath,
      canRemove: true,
    });
    expect(h.requests).toEqual([
      `${BASE}/latest`,
      `${BASE}/${VERSION}/manifest.json`,
      `${BASE}/${VERSION}/darwin-arm64/claude`,
    ]);
    expect(new Uint8Array(yield* h.fs.readFile(h.executablePath))).toEqual(binary);
    expect((yield* h.fs.readDirectory(h.installation.managedDirectory)).toSorted()).toEqual([
      "bin",
      "install.json",
    ]);

    const restarted = yield* makeHarness({ baseDir: h.baseDir });
    expect(yield* restarted.installation.state).toMatchObject({
      phase: "idle",
      installedVersion: VERSION,
      executablePath: h.executablePath,
      canRemove: true,
    });

    yield* restarted.installation.remove();
    expect(yield* restarted.installation.state).toMatchObject({
      phase: "idle",
      installedVersion: null,
      executablePath: null,
      canRemove: false,
    });
    expect(yield* h.fs.exists(restarted.installation.managedDirectory)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect.each([
  { name: "checksum mismatch", input: { checksum: "0".repeat(64) }, message: "SHA-256" },
  { name: "platform missing", input: { manifestPlatform: "linux-x64" }, message: "darwin-arm64" },
  { name: "invalid version", input: { latest: "<html>blocked</html>" }, message: "region" },
])("rejects a release without publishing a binary: $name", ({ input, message }) =>
  Effect.gen(function* () {
    const h = yield* makeHarness(input);
    yield* h.installation.start;
    const state = yield* terminalState(h.installation);
    expect(state.phase).toBe("failed");
    expect(state.message).toContain(message);
    expect(state.installedVersion).toBeNull();
    expect(yield* h.fs.exists(h.executablePath)).toBe(false);
    expect(yield* h.fs.exists(`${h.installation.managedDirectory}/install.json`)).toBe(false);
    const entries = yield* h.fs
      .readDirectory(h.installation.managedDirectory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    expect(entries.filter((name) => name.startsWith(".install-"))).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("cancels an in-flight download and cleans the staging directory", () =>
  Effect.gen(function* () {
    const downloading = yield* Deferred.make<void>();
    const h = yield* makeHarness({
      body: Stream.fromEffect(
        Deferred.succeed(downloading, undefined).pipe(Effect.andThen(Effect.never)),
      ),
    });
    const started = yield* h.installation.start;
    expect(yield* h.installation.start).toMatchObject({ operationId: started.operationId });
    yield* Deferred.await(downloading);
    expect((yield* h.installation.cancel(started.operationId!)).phase).toBe("cancelled");
    expect(
      (yield* h.fs.readDirectory(h.installation.managedDirectory)).filter((name) =>
        name.startsWith(".install-"),
      ),
    ).toEqual([]);
    expect(yield* h.fs.exists(h.executablePath)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("prefers claude on PATH, then the managed binary, and keeps custom paths", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-resolve-test-" });
    const localDirectory = `${baseDir}/local`;
    yield* fs.makeDirectory(localDirectory);
    yield* fs.writeFileString(`${localDirectory}/claude`, "#!/bin/sh\n", { mode: 0o755 });
    const resolve = (configured: string, PATH: string) =>
      ClaudeInstallation.resolveClaudeBinaryPath({
        configured,
        baseDir,
        environment: { PATH },
      }).pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Architecture, "arm64"),
      );
    expect(yield* resolve("claude", localDirectory)).toBe("claude");
    expect(yield* resolve("claude", "")).toBe(`${baseDir}/tools/claude/bin/claude`);
    expect(yield* resolve("/opt/claude", "")).toBe("/opt/claude");
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
