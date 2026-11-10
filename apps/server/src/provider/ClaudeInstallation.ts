// @effect-diagnostics nodeBuiltinImport:off - Effect has no incremental digest.
import { ProviderDriverKind, type ProviderInstallState } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath, resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeCrypto from "node:crypto";

import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";

import * as ServerConfig from "../config.ts";

const DRIVER = ProviderDriverKind.make("claudeAgent");
/** Same bucket, `latest` pointer and manifest as https://claude.ai/install.sh and install.ps1. */
export const CLAUDE_RELEASES_BASE_URL = "https://downloads.claude.ai/claude-code-releases";
const STAGING_STALE_AFTER_MS = 24 * 60 * 60_000;
const MAX_BINARY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const RECORD_FILE = "install.json";

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u));
const ReleaseManifest = Schema.Struct({
  version: Version,
  platforms: Schema.Record(
    Schema.String,
    Schema.Struct({
      checksum: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
      size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_BINARY_BYTES })),
    }),
  ),
});
const InstalledRelease = Schema.Struct({
  version: Version,
  platform: Schema.String,
  sha256: Schema.String,
  size: Schema.Number,
});
const decodeVersion = Schema.decodeUnknownEffect(Version);
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseManifest));
const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(InstalledRelease));
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(InstalledRelease));

export interface ClaudeReleasePlatformInput {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Windows reports `ARM64` here even when an x64 Node runs under emulation. */
  readonly processorArchitecture?: string | undefined;
  readonly musl?: boolean;
  readonly rosetta?: boolean;
}

/** Mirrors the platform detection in Anthropic's install.sh and install.ps1. */
export function resolveClaudeReleasePlatform(input: ClaudeReleasePlatformInput): string | null {
  if (input.platform === "win32") {
    if (input.arch === "arm64" || input.processorArchitecture?.toUpperCase() === "ARM64")
      return "win32-arm64";
    return input.arch === "x64" ? "win32-x64" : null;
  }
  if (input.platform !== "darwin" && input.platform !== "linux") return null;
  const arch =
    input.arch === "arm64" ? "arm64" : input.arch === "x64" ? "x64" : (null as string | null);
  if (arch === null) return null;
  if (input.platform === "darwin") return `darwin-${input.rosetta ? "arm64" : arch}`;
  return `linux-${arch}${input.musl ? "-musl" : ""}`;
}

export const isClaudeManagedInstallSupported = (
  platform: NodeJS.Platform,
  arch: string,
  environment: NodeJS.ProcessEnv,
) =>
  resolveClaudeReleasePlatform({
    platform,
    arch,
    processorArchitecture: environment.PROCESSOR_ARCHITECTURE,
  }) !== null;

export const claudeManagedBinDirectory = (path: Path.Path, toolsDir: string) =>
  path.join(toolsDir, "claude", "bin");

/** A stable path, replaced in place, so a running provider picks up installs without a rebuild. */
const claudeManagedExecutablePath = (path: Path.Path, baseDir: string, platform: NodeJS.Platform) =>
  path.join(
    claudeManagedBinDirectory(path, path.join(baseDir, "tools")),
    platform === "win32" ? "claude.exe" : "claude",
  );

/** Keeps Claude's self-updater off the managed binary; the app owns its updates. Never for a user's own CLI. */
export const MANAGED_CLAUDE_ENVIRONMENT = [
  { name: "DISABLE_AUTOUPDATER", value: "1", sensitive: false },
] as const;

/** A default `claude` path prefers a CLI on PATH, then the managed install. */
export const resolveClaudeBinaryPath = Effect.fn("ClaudeInstallation.resolveBinaryPath")(
  function* (input: {
    readonly configured: string;
    readonly baseDir: string;
    readonly environment: NodeJS.ProcessEnv;
  }) {
    if (input.configured !== "claude") return input.configured;
    const platform = yield* HostProcess.Platform;
    const arch = yield* HostProcess.Architecture;
    if (!isClaudeManagedInstallSupported(platform, arch, input.environment)) return "claude";
    const path = yield* Path.Path;
    const managed = claudeManagedExecutablePath(path, input.baseDir, platform);
    const local = yield* resolveCommandPath("claude", { env: input.environment }).pipe(
      Effect.orElseSucceed(() => null),
    );
    return local !== null && path.resolve(local) !== managed ? "claude" : managed;
  },
);

export class ClaudeInstallationError extends Schema.TaggedError<ClaudeInstallationError>()(
  "ClaudeInstallationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return this.detail;
  }
}
const isInstallationError = Schema.is(ClaudeInstallationError);
const installationError = (operation: string, detail: string, cause?: unknown) =>
  new ClaudeInstallationError({ operation, detail, ...(cause === undefined ? {} : { cause }) });
const wrapFailure = (operation: string, detail: string) => (cause: unknown) =>
  isInstallationError(cause) ? cause : installationError(operation, detail, cause);

interface ClaudeInstallationService {
  readonly managedDirectory: string;
  readonly start: Effect.Effect<ProviderInstallState, ClaudeInstallationError>;
  readonly cancel: (
    operationId: string,
  ) => Effect.Effect<ProviderInstallState, ClaudeInstallationError>;
  readonly state: Effect.Effect<ProviderInstallState>;
  readonly changes: Stream.Stream<ProviderInstallState>;
  readonly remove: (
    protectedBinaryPaths?: ReadonlyArray<string>,
  ) => Effect.Effect<void, ClaudeInstallationError>;
}

export class ClaudeInstallation extends Context.Service<
  ClaudeInstallation,
  ClaudeInstallationService
>()("t3/provider/ClaudeInstallation") {
  static readonly layer = Layer.effect(
    ClaudeInstallation,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return yield* makeClaudeInstallation({ baseDir: config.baseDir });
    }),
  );
}

export interface ClaudeInstallationOptions {
  readonly baseDir: string;
  /** Overrides host detection; `null` means no official build exists for this host. */
  readonly releasePlatform?: string | null;
  readonly validate?: (
    executablePath: string,
    expectedVersion: string,
  ) => Effect.Effect<void, ClaudeInstallationError, Scope.Scope>;
}

const isRunning = (state: ProviderInstallState) =>
  ["downloading", "extracting", "verifying"].includes(state.phase);

export const makeClaudeInstallation = Effect.fn("makeClaudeInstallation")(function* (
  options: ClaudeInstallationOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const http = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serviceScope = yield* Effect.scope;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const arch = yield* HostProcess.Architecture;
  const supported =
    options.releasePlatform === undefined
      ? isClaudeManagedInstallSupported(platform, arch, environment)
      : options.releasePlatform !== null;
  const managedDirectory = path.join(options.baseDir, "tools", "claude");
  const executablePath = claudeManagedExecutablePath(path, options.baseDir, platform);
  const binDirectory = path.dirname(executablePath);
  const recordPath = path.join(managedDirectory, RECORD_FILE);
  const gate = yield* Semaphore.make(1);
  let running: { readonly operationId: string; readonly fiber: Fiber.Fiber<void> } | undefined;
  const state = yield* SubscriptionRef.make<ProviderInstallState>({
    driver: DRIVER,
    operationId: null,
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: null,
    version: null,
    installedVersion: null,
    executablePath: null,
    canRemove: false,
    message: null,
  });

  const runCommand = Effect.fn("ClaudeInstallation.runCommand")(function* (
    command: string,
    args: ReadonlyArray<string>,
    env?: NodeJS.ProcessEnv,
  ) {
    const resolved = yield* resolveSpawnCommand(command, args).pipe(
      Effect.provideService(HostProcess.Platform, platform),
    );
    const child = yield* spawner.spawn(
      ChildProcess.make(resolved.command, resolved.args, {
        shell: resolved.shell,
        ...(env ? { env } : {}),
      }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        child.stdout.pipe(Stream.decodeText(), Stream.mkString),
        child.stderr.pipe(Stream.decodeText(), Stream.mkString),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    return { stdout, stderr, exitCode };
  }, Effect.scoped);

  const detectReleasePlatform = Effect.fn("ClaudeInstallation.detectReleasePlatform")(function* () {
    if (options.releasePlatform !== undefined) return options.releasePlatform;
    // Same checks as install.sh: a musl loader, or ldd naming musl; Rosetta gets the arm64 build.
    const musl =
      platform === "linux" &&
      ((yield* fs.exists("/lib/libc.musl-x86_64.so.1").pipe(Effect.orElseSucceed(() => false))) ||
        (yield* fs.exists("/lib/libc.musl-aarch64.so.1").pipe(Effect.orElseSucceed(() => false))) ||
        (yield* runCommand("ldd", ["/bin/ls"]).pipe(
          Effect.map(({ stdout, stderr }) => `${stdout}${stderr}`.includes("musl")),
          Effect.orElseSucceed(() => false),
        )));
    const rosetta =
      platform === "darwin" &&
      arch === "x64" &&
      (yield* runCommand("sysctl", ["-n", "sysctl.proc_translated"]).pipe(
        Effect.map(({ stdout }) => stdout.trim() === "1"),
        Effect.orElseSucceed(() => false),
      ));
    return resolveClaudeReleasePlatform({
      platform,
      arch,
      processorArchitecture: environment.PROCESSOR_ARCHITECTURE,
      musl,
      rosetta,
    });
  });

  const readInstalled = Effect.fn("ClaudeInstallation.readInstalled")(function* () {
    const info = yield* fs.stat(recordPath);
    if (info.type !== "File" || Number(info.size) > 8192)
      return yield* installationError("resolve", "The managed Claude Code record is invalid.");
    const record = yield* decodeRecord(yield* fs.readFileString(recordPath));
    const binary = yield* fs.stat(executablePath);
    if (
      binary.type !== "File" ||
      Number(binary.size) !== record.size ||
      (platform !== "win32" && (binary.mode & 0o111) === 0)
    )
      return yield* installationError("resolve", "The managed Claude Code binary is incomplete.");
    return record;
  });

  const fetchText = Effect.fn("ClaudeInstallation.fetchText")(function* (url: string) {
    const response = yield* http
      .execute(HttpClientRequest.get(url))
      .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
    const text = yield* response.text;
    if (text.length > MAX_METADATA_BYTES)
      return yield* installationError("download", "The Claude Code release metadata is too large.");
    return text;
  });

  const resolveRelease = Effect.fn("ClaudeInstallation.resolveRelease")(function* (
    releasePlatform: string,
  ) {
    const version = yield* decodeVersion(
      (yield* fetchText(`${CLAUDE_RELEASES_BASE_URL}/latest`)).trim(),
    ).pipe(
      Effect.mapError((cause) =>
        installationError(
          "download",
          "downloads.claude.ai did not return a valid Claude Code version. The service may be unreachable or unavailable in your region.",
          cause,
        ),
      ),
    );
    const manifest = yield* decodeManifest(
      yield* fetchText(`${CLAUDE_RELEASES_BASE_URL}/${version}/manifest.json`),
    ).pipe(
      Effect.mapError((cause) =>
        installationError("download", "The Claude Code release manifest is invalid.", cause),
      ),
    );
    const entry = manifest.platforms[releasePlatform];
    if (manifest.version !== version || entry === undefined)
      return yield* installationError(
        "download",
        `Anthropic does not publish Claude Code ${version} for ${releasePlatform}.`,
      );
    return {
      version,
      platform: releasePlatform,
      url: `${CLAUDE_RELEASES_BASE_URL}/${version}/${releasePlatform}/${platform === "win32" ? "claude.exe" : "claude"}`,
      sha256: entry.checksum,
      size: entry.size,
    };
  });

  const validate =
    options.validate ??
    Effect.fn("ClaudeInstallation.validate")(
      function* (candidate: string, version: string) {
        const { stdout, exitCode } = yield* runCommand(
          candidate,
          ["--version"],
          yield* mergeProviderInstanceEnvironment(MANAGED_CLAUDE_ENVIRONMENT, environment),
        );
        if (exitCode !== 0 || stdout.trim().split(/\s/u)[0] !== version)
          return yield* installationError(
            "verify",
            "The downloaded Claude Code binary reported the wrong version.",
          );
      },
      Effect.mapError(wrapFailure("verify", "The downloaded Claude Code binary could not start.")),
    );

  const report = (patch: Partial<ProviderInstallState>) =>
    SubscriptionRef.update(state, (current) => ({ ...current, ...patch }));

  const install = Effect.fn("ClaudeInstallation.install")(
    function* () {
      const releasePlatform = yield* detectReleasePlatform();
      if (releasePlatform === null)
        return yield* installationError(
          "start",
          `Anthropic does not publish Claude Code for ${platform}-${arch}.`,
        );
      const release = yield* resolveRelease(releasePlatform).pipe(
        Effect.timeout("2 minutes"),
        Effect.catchTags({
          TimeoutError: (cause) =>
            installationError(
              "download",
              "downloads.claude.ai did not answer. Check your internet connection, then retry installation.",
              cause,
            ),
        }),
      );
      yield* report({
        version: release.version,
        totalBytes: release.size,
        message: `Downloading Claude Code ${release.version}.`,
      });
      yield* fs.makeDirectory(binDirectory, { recursive: true });
      yield* report({ canRemove: true });
      const staging = yield* fs.makeTempDirectoryScoped({
        directory: managedDirectory,
        prefix: ".install-",
      });
      const download = path.join(staging, path.basename(executablePath));
      const hash = NodeCrypto.createHash("sha256");
      let downloadedBytes = 0;
      let lastProgressAt = yield* Clock.currentTimeMillis;
      const response = yield* http
        .execute(HttpClientRequest.get(release.url))
        .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
      yield* response.stream.pipe(
        Stream.tap((chunk) =>
          Effect.gen(function* () {
            downloadedBytes += chunk.byteLength;
            if (downloadedBytes > release.size)
              return yield* installationError(
                "download",
                "The Claude Code download exceeded the size in Anthropic's manifest.",
              );
            hash.update(chunk);
            const now = yield* Clock.currentTimeMillis;
            if (now - lastProgressAt >= 250 || downloadedBytes === release.size) {
              lastProgressAt = now;
              yield* report({ downloadedBytes });
            }
          }),
        ),
        Stream.run(fs.sink(download, { flag: "wx", mode: 0o755 })),
        Effect.timeout("45 minutes"),
        Effect.catchTags({
          TimeoutError: (cause) =>
            installationError(
              "download",
              "The Claude Code download timed out. Retry installation.",
              cause,
            ),
        }),
      );
      if (downloadedBytes !== release.size || hash.digest("hex") !== release.sha256)
        return yield* installationError(
          "download",
          "The Claude Code download failed its size or SHA-256 check. Nothing was installed.",
        );
      yield* report({ phase: "verifying", message: "Checking Claude Code." });
      yield* validate(download, release.version).pipe(Effect.scoped, Effect.timeout("90 seconds"));
      const record = yield* encodeRecord({
        version: release.version,
        platform: release.platform,
        sha256: release.sha256,
        size: release.size,
      });
      yield* Effect.gen(function* () {
        // Windows cannot replace a running exe but can rename it; startup removes retired copies.
        const retired =
          platform === "win32" && (yield* fs.exists(executablePath))
            ? path.join(binDirectory, `.retired-${yield* random.uuidV4()}.exe`)
            : null;
        if (retired) yield* fs.rename(executablePath, retired);
        // Defender or process rundown may hold claude.exe briefly after --version exits.
        const publish = fs.rename(download, executablePath);
        yield* (
          platform === "win32"
            ? publish.pipe(Effect.retry({ times: 10, schedule: Schedule.spaced("100 millis") }))
            : publish
        ).pipe(Effect.tapError(() => (retired ? fs.rename(retired, executablePath) : Effect.void)));
        if (retired) yield* fs.remove(retired).pipe(Effect.ignore);
        const pointer = path.join(staging, RECORD_FILE);
        yield* fs.writeFileString(pointer, record, { flag: "wx", mode: 0o600 });
        yield* fs.rename(pointer, recordPath);
      }).pipe(Effect.uninterruptible);
      return release.version;
    },
    Effect.scoped,
    Effect.catchTags({
      HttpClientError: (cause) => {
        const httpStatus =
          cause.reason._tag === "StatusCodeError" ? cause.reason.response.status : undefined;
        return installationError(
          "download",
          httpStatus === undefined
            ? "The Claude Code download was interrupted. Check your internet connection, then retry installation."
            : `downloads.claude.ai returned HTTP ${httpStatus}. Try again later.`,
          cause,
        );
      },
    }),
    Effect.mapError(
      wrapFailure(
        "install",
        "Could not install Claude Code. Check disk space and directory access, then try again.",
      ),
    ),
  );

  const reuseLocal = Effect.fn("ClaudeInstallation.reuseLocal")(
    function* () {
      const local = yield* resolveCommandPath("claude", { env: environment }).pipe(
        Effect.provideService(HostProcess.Platform, platform),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      if (local === null || path.resolve(local) === executablePath) return false;
      const { stdout, exitCode } = yield* runCommand(local, ["--version"]).pipe(
        Effect.timeout("5 seconds"),
      );
      const version = /^(\d+\.\d+\.\d+)/u.exec(stdout.trim())?.[1];
      if (exitCode !== 0 || !version) return false;
      yield* report({
        phase: "succeeded",
        source: "local",
        operationId: null,
        installedVersion: version,
        executablePath: local,
        downloadedBytes: 0,
        totalBytes: null,
        message: null,
      });
      return true;
    },
    Effect.orElseSucceed(() => false),
  );

  const start = gate
    .withPermit(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (isRunning(current)) return current;
        if (yield* reuseLocal()) return yield* SubscriptionRef.get(state);
        if (!supported)
          return yield* installationError(
            "start",
            `Anthropic does not publish Claude Code for ${platform}-${arch}. Set a custom binary path or use another environment.`,
          );
        const operationId = yield* random.uuidV4();
        const next: ProviderInstallState = {
          driver: DRIVER,
          operationId,
          phase: "downloading",
          downloadedBytes: 0,
          totalBytes: null,
          version: null,
          installedVersion: current.installedVersion,
          executablePath: current.executablePath ?? null,
          canRemove: current.canRemove,
          message: "Finding the latest Claude Code release.",
        };
        yield* SubscriptionRef.set(state, next);
        const work = install().pipe(
          // Reported after the staging scope closes, so success means the cleanup is done too.
          Effect.tap((version) =>
            report({
              phase: "succeeded",
              source: "managed",
              installedVersion: version,
              executablePath,
              message: null,
            }),
          ),
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? SubscriptionRef.update(state, (value) => {
                  if (value.operationId !== operationId || value.phase === "succeeded")
                    return value;
                  const error = Cause.findErrorOption(exit.cause);
                  const cancelled = Cause.hasInterruptsOnly(exit.cause);
                  return {
                    ...value,
                    phase: cancelled ? "cancelled" : "failed",
                    message: cancelled
                      ? "Installation cancelled. The previous Claude Code is unchanged."
                      : Option.isSome(error)
                        ? error.value.detail
                        : "Could not finish the Claude Code installation. Check disk space and directory access.",
                  } satisfies ProviderInstallState;
                })
              : Effect.void,
          ),
          Effect.ignoreCause,
          Effect.ensuring(
            Effect.sync(() => {
              if (running?.operationId === operationId) running = undefined;
            }),
          ),
        );
        const fiber = yield* Effect.forkIn(Effect.interruptible(work), serviceScope);
        running = { operationId, fiber };
        return next;
      }).pipe(Effect.uninterruptible),
    )
    .pipe(Effect.mapError(wrapFailure("start", "Could not start the Claude Code installation.")));

  const cancel = Effect.fn("ClaudeInstallation.cancel")(function* (operationId: string) {
    return yield* gate.withPermit(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (current.operationId !== operationId)
          return yield* installationError(
            "cancel",
            "This installation is no longer current. Refresh its status before cancelling.",
          );
        if (running?.operationId === operationId && isRunning(current))
          yield* Fiber.interrupt(running.fiber);
        return yield* SubscriptionRef.get(state);
      }),
    );
  });

  const remove = Effect.fn("ClaudeInstallation.remove")(
    function* (protectedBinaryPaths: ReadonlyArray<string> = []) {
      yield* gate.withPermit(
        Effect.gen(function* () {
          if (isRunning(yield* SubscriptionRef.get(state)))
            return yield* installationError(
              "remove",
              "Wait for the Claude Code installation to finish before removing it.",
            );
          const realManaged = yield* fs.realPath(managedDirectory).pipe(Effect.option);
          if (Option.isSome(realManaged)) {
            for (const binary of protectedBinaryPaths) {
              const resolved = yield* fs.realPath(binary).pipe(Effect.option);
              const candidate = Option.getOrElse(resolved, () => path.resolve(binary));
              if (candidate.startsWith(`${realManaged.value}${path.sep}`))
                return yield* installationError(
                  "remove",
                  "A provider instance uses a custom path inside managed Claude Code. Clear that path before removing it.",
                );
            }
          }
          yield* fs.remove(managedDirectory, { recursive: true, force: true });
          yield* SubscriptionRef.update(
            state,
            (current) =>
              ({
                ...current,
                operationId: null,
                phase: "idle",
                downloadedBytes: 0,
                installedVersion: null,
                executablePath: null,
                source: null,
                canRemove: false,
                message: null,
              }) satisfies ProviderInstallState,
          );
          yield* reuseLocal();
        }).pipe(Effect.uninterruptible),
      );
    },
    Effect.mapError(
      wrapFailure(
        "remove",
        "Could not remove the managed Claude Code. Stop Claude sessions and try again.",
      ),
    ),
  );

  yield* Effect.gen(function* () {
    if (!(yield* fs.exists(managedDirectory))) return;
    // Another server sharing this home may be mid-download, so only clear long-stale staging.
    const now = yield* Clock.currentTimeMillis;
    const stale = (directory: string, prefix: string, maxAgeMs: number) =>
      fs.readDirectory(directory).pipe(
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
        Effect.flatMap((entries) =>
          Effect.forEach(
            entries.filter((entry) => entry.startsWith(prefix)),
            (entry) =>
              Effect.gen(function* () {
                const target = path.join(directory, entry);
                const info = yield* fs.stat(target);
                const modifiedAt = Option.match(info.mtime, {
                  onNone: () => now,
                  onSome: (date) => date.getTime(),
                });
                if (now - modifiedAt >= maxAgeMs)
                  yield* fs.remove(target, { recursive: true, force: true });
              }).pipe(Effect.ignore),
            { discard: true },
          ),
        ),
      );
    yield* stale(managedDirectory, ".install-", STAGING_STALE_AFTER_MS);
    yield* stale(binDirectory, ".retired-", 0);
    yield* report({ canRemove: true });
    if (!(yield* fs.exists(recordPath))) return;
    const installed = yield* readInstalled();
    yield* report({
      installedVersion: installed.version,
      executablePath,
      source: "managed",
    });
  }).pipe(
    Effect.catch(() =>
      report({
        phase: "failed",
        message: "The managed Claude Code is incomplete. Remove it and reinstall.",
      }),
    ),
  );

  return ClaudeInstallation.of({
    managedDirectory,
    start,
    cancel,
    state: SubscriptionRef.get(state),
    changes: SubscriptionRef.changes(state),
    remove,
  });
});
