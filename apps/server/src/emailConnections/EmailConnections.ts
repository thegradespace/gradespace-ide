import {
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type EmailConnectionStatus,
  type EmailConnectionsReport,
  type ProviderInstanceEnvironment,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import * as ServerSettings from "../serverSettings.ts";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const DEFAULT_CLAUDE_SETTINGS = Schema.decodeSync(ClaudeSettings)({});
const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});

type Finding = Pick<EmailConnectionStatus, "state" | "connectors">;

const UNKNOWN: Finding = { state: "unknown", connectors: [] };

/** `Gmail` or `Outlook` for a plugin, server or connector name that reaches one. */
function emailServiceOf(name: string): string | null {
  const normalized = name.toLowerCase();
  if (normalized.includes("outlook")) return "Outlook";
  if (/gmail|google[-_ ]?mail/u.test(normalized)) return "Gmail";
  return null;
}

const found = (names: Iterable<string>): Finding => {
  const services = [
    ...new Set([...names].flatMap((name) => emailServiceOf(name) ?? [])),
  ].toSorted();
  return services.length > 0
    ? { state: "connected", connectors: services }
    : { state: "notConnected", connectors: [] };
};

const TOML_TABLE =
  /^\s*\[\s*(plugins|mcp_servers)\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/u;
const TOML_ANY_TABLE = /^\s*\[/u;
const TOML_ENABLED = /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/u;

/**
 * Enabled `[plugins."…"]` and `[mcp_servers.…]` tables in a Codex config.toml. A small line
 * scanner: the server has no TOML parser, and only these table headers and `enabled` matter.
 */
export function codexEmailFinding(
  configToml: string,
  /** `name@marketplace` for each plugin Codex has cached, which covers account plugins. */
  cachedPlugins: ReadonlyArray<string> = [],
): Finding {
  const tables: Array<{ name: string; enabled: boolean }> = [];
  let current: { name: string; enabled: boolean } | null = null;
  for (const line of configToml.split(/\r?\n/u)) {
    const table = TOML_TABLE.exec(line);
    if (table) {
      current = { name: table[2] ?? table[3] ?? table[4] ?? "", enabled: true };
      tables.push(current);
      continue;
    }
    if (TOML_ANY_TABLE.test(line)) {
      current = null;
      continue;
    }
    const enabled = current === null ? null : TOML_ENABLED.exec(line);
    if (current !== null && enabled) current.enabled = enabled[1] === "true";
  }
  const disabled = new Set(tables.filter((table) => !table.enabled).map((table) => table.name));
  return found([
    ...tables.filter((table) => table.enabled).map((table) => table.name),
    ...cachedPlugins.filter((plugin) => !disabled.has(plugin)),
  ]);
}

const ClaudeGlobalConfig = Schema.fromJsonString(
  Schema.Struct({
    claudeAiMcpEverConnected: Schema.optional(Schema.Array(Schema.String)),
    mcpServers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);
const decodeClaudeGlobalConfig = Schema.decodeUnknownOption(ClaudeGlobalConfig);

/**
 * Claude Code's global `.claude.json`. claude.ai connectors live in the account, not on disk;
 * Claude Code records each one it has connected in `claudeAiMcpEverConnected`, so a missing
 * list means it never checked and the answer stays unknown.
 */
export function claudeEmailFinding(globalConfigJson: string): Finding {
  const parsed = decodeClaudeGlobalConfig(globalConfigJson);
  if (Option.isNone(parsed)) return UNKNOWN;
  const names = [
    ...(parsed.value.claudeAiMcpEverConnected ?? []),
    ...Object.keys(parsed.value.mcpServers ?? {}),
  ];
  const finding = found(names);
  return finding.state === "notConnected" && parsed.value.claudeAiMcpEverConnected === undefined
    ? UNKNOWN
    : finding;
}

export class EmailConnections extends Context.Service<
  EmailConnections,
  {
    /** Never fails: anything unreadable reports `unknown` for that provider instance. */
    readonly status: Effect.Effect<EmailConnectionsReport>;
  }
>()("t3/emailConnections/EmailConnections") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsService = yield* ServerSettings.ServerSettingsService;

  const readFinding = (file: string, parse: (contents: string) => Finding, missing: Finding) =>
    fs.readFileString(file).pipe(
      Effect.map(parse),
      Effect.catch((error) =>
        Effect.succeed(
          error._tag === "PlatformError" && error.reason._tag === "NotFound" ? missing : UNKNOWN,
        ),
      ),
    );

  const codexFinding = Effect.fn("EmailConnections.codexFinding")(function* (
    config: unknown,
    environment: NodeJS.ProcessEnv,
  ) {
    const settings = Option.getOrElse(
      decodeCodexSettings(config ?? {}),
      () => DEFAULT_CODEX_SETTINGS,
    );
    const environmentHome = environment.CODEX_HOME?.trim();
    const layout = yield* resolveCodexHomeLayout(
      !settings.homePath.trim() && !settings.shadowHomePath.trim() && environmentHome
        ? { ...settings, homePath: environmentHome }
        : settings,
    );
    // Remote plugins connected in ChatGPT never reach config.toml; Codex caches them under
    // plugins/cache/<marketplace>/<plugin>.
    const cacheRoot = path.join(layout.sharedHomePath, "plugins", "cache");
    const listDirectory = (directory: string) =>
      fs.readDirectory(directory).pipe(Effect.orElseSucceed((): string[] => []));
    const cachedPlugins = (yield* Effect.forEach(yield* listDirectory(cacheRoot), (marketplace) =>
      listDirectory(path.join(cacheRoot, marketplace)).pipe(
        Effect.map((plugins) => plugins.map((plugin) => `${plugin}@${marketplace}`)),
      ),
    )).flat();
    // No config.toml means nothing is set up yet, which is a plain "not connected".
    return yield* readFinding(
      path.join(layout.sharedHomePath, "config.toml"),
      (contents) => codexEmailFinding(contents, cachedPlugins),
      codexEmailFinding("", cachedPlugins),
    );
  });

  const claudeFinding = Effect.fn("EmailConnections.claudeFinding")(function* (
    config: unknown,
    environment: NodeJS.ProcessEnv,
  ) {
    const settings = Option.getOrElse(
      decodeClaudeSettings(config ?? {}),
      () => DEFAULT_CLAUDE_SETTINGS,
    );
    const home = yield* HostProcess.HomeDirectory;
    const claudeHome = yield* resolveClaudeHomePath(settings, environment);
    // Claude Code keeps `.claude.json` beside the default `~/.claude`, and inside a custom one.
    const globalConfig =
      claudeHome === path.resolve(home, ".claude")
        ? path.join(home, ".claude.json")
        : path.join(claudeHome, ".claude.json");
    return yield* readFinding(globalConfig, claudeEmailFinding, UNKNOWN);
  });

  const status = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(Effect.option);
    const hostEnvironment = yield* HostProcess.Environment;
    const configured = Option.isSome(settings) ? settings.value.providerInstances : {};
    const instances: Array<{
      instanceId: ProviderInstanceId;
      driver: ProviderDriverKind;
      config: unknown;
      environment: ProviderInstanceEnvironment | undefined;
    }> = [];
    for (const driver of [CODEX, CLAUDE]) {
      const entries = Object.entries(configured).filter(([, entry]) => entry.driver === driver);
      if (!Object.hasOwn(configured, driver)) entries.unshift([driver, { driver }]);
      for (const [id, entry] of entries) {
        instances.push({
          instanceId: ProviderInstanceId.make(id),
          driver,
          config: entry.config,
          environment: entry.environment,
        });
      }
    }
    const providers = yield* Effect.forEach(instances, (instance) =>
      Effect.gen(function* () {
        const environment = yield* mergeProviderInstanceEnvironment(
          instance.environment,
          hostEnvironment,
        );
        const finding =
          instance.driver === CODEX
            ? yield* codexFinding(instance.config, environment)
            : yield* claudeFinding(instance.config, environment);
        return { instanceId: instance.instanceId, driver: instance.driver, ...finding };
      }),
    );
    return { providers };
  }).pipe(Effect.provideService(Path.Path, path), Effect.withSpan("EmailConnections.status"));

  return EmailConnections.of({ status });
});

export const layer = Layer.effect(EmailConnections, make);
