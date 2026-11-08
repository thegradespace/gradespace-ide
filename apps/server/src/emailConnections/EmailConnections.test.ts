import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import * as EmailConnections from "./EmailConnections.ts";

describe("codexEmailFinding", () => {
  it("finds enabled Gmail and Outlook plugins and MCP servers only", () => {
    const toml = [
      '[plugins."browser@openai-bundled"]',
      "enabled = true",
      "",
      '[plugins."gmail@openai-curated-remote"]',
      "enabled = true # connected in ChatGPT",
      "",
      '[plugins."outlook@openai-curated-remote"]',
      "enabled = false",
      "",
      "[mcp_servers.google-mail]",
      'command = "npx"',
    ].join("\n");
    expect(EmailConnections.codexEmailFinding(toml)).toEqual({
      state: "connected",
      connectors: ["Gmail"],
    });
    expect(
      EmailConnections.codexEmailFinding('[plugins."outlook@x"]\n[profiles.work]\nenabled = false'),
    ).toEqual({ state: "connected", connectors: ["Outlook"] });
    expect(
      EmailConnections.codexEmailFinding(
        '[plugins."gmail@x"]\nenabled = false\n[mcp_servers.repl]',
      ),
    ).toEqual({ state: "notConnected", connectors: [] });
  });

  it("counts a cached account plugin unless config.toml turns it off", () => {
    const cached = ["gmail@openai-curated-remote", "figma@openai-curated-remote"];
    expect(EmailConnections.codexEmailFinding("", cached)).toEqual({
      state: "connected",
      connectors: ["Gmail"],
    });
    expect(
      EmailConnections.codexEmailFinding(
        '[plugins."gmail@openai-curated-remote"]\nenabled = false',
        cached,
      ).state,
    ).toBe("notConnected");
  });
});

describe("claudeEmailFinding", () => {
  it.each([
    [{ claudeAiMcpEverConnected: ["claude.ai Gmail", "claude.ai Docs"] }, "connected"],
    [{ claudeAiMcpEverConnected: ["claude.ai Docs"] }, "notConnected"],
    [{ mcpServers: { "outlook-mcp": {} } }, "connected"],
    // Without the connector list Claude Code never looked at claude.ai connectors.
    [{ mcpServers: { github: {} } }, "unknown"],
    ["not json", "unknown"],
  ] as const)("reads %j as %s", (config, state) => {
    const json = typeof config === "string" ? config : JSON.stringify(config);
    expect(EmailConnections.claudeEmailFinding(json).state).toBe(state);
  });
});

describe("claudeMcpListEmailFinding", () => {
  it.each([
    ["claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected", "connected"],
    [
      "claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ! Needs authentication",
      "notConnected",
    ],
    ["Checking MCP server health…\n\nclaude.ai Docs: https://x - ✔ Connected", "notConnected"],
  ] as const)("reads %j as %s", (output, state) => {
    expect(EmailConnections.claudeMcpListEmailFinding(output).state).toBe(state);
  });
});

const layer = (settings: Parameters<typeof ServerSettings.layerTest>[0]) =>
  EmailConnections.layer.pipe(
    Layer.provideMerge(ServerSettings.layerTest(settings)),
    Layer.provideMerge(NodeServices.layer),
  );

it.effect("reports every Codex and Claude instance from its own home", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-email-connections-" });
    const workCodex = path.join(home, "work-codex");
    yield* fs.makeDirectory(path.join(home, ".codex"));
    yield* fs.makeDirectory(
      path.join(workCodex, "plugins", "cache", "openai-curated-remote", "outlook"),
      {
        recursive: true,
      },
    );
    yield* fs.writeFileString(
      path.join(home, ".codex", "config.toml"),
      '[plugins."gmail@openai-curated-remote"]\nenabled = true\n',
    );
    yield* fs.writeFileString(
      path.join(home, ".claude.json"),
      JSON.stringify({ claudeAiMcpEverConnected: ["claude.ai Calendar"] }),
    );

    // A connector connected on claude.ai that no chat has used yet: only `claude mcp list` sees it.
    const fakeClaude = path.join(home, "fake-claude");
    yield* fs.writeFileString(
      fakeClaude,
      "#!/bin/sh\necho 'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected'\n",
    );
    yield* fs.chmod(fakeClaude, 0o755);

    const report = yield* Effect.gen(function* () {
      const service = yield* EmailConnections.EmailConnections;
      return yield* service.status;
    }).pipe(
      Effect.provide(
        layer({
          providerInstances: {
            [ProviderInstanceId.make("codex_work")]: {
              driver: ProviderDriverKind.make("codex"),
              config: { homePath: workCodex },
            },
            [ProviderInstanceId.make("claude_work")]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              config: { binaryPath: fakeClaude },
            },
          },
        }),
      ),
      Effect.provideService(HostProcess.HomeDirectory, home),
      // An empty environment keeps a developer's own CODEX_HOME or CLAUDE_CONFIG_DIR out of reach.
      Effect.provideService(HostProcess.Environment, {}),
    );

    expect(report.providers.map((p) => [p.instanceId, p.state, p.connectors])).toEqual([
      ["codex", "connected", ["Gmail"]],
      ["codex_work", "connected", ["Outlook"]],
      ["claudeAgent", "notConnected", []],
      ["claude_work", "connected", ["Gmail"]],
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
