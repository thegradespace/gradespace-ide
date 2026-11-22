// @effect-diagnostics nodeBuiltinImport:off - This developer command runs Docker, the built server CLI and a local TLS proxy.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTls from "node:tls";
import * as NodeURL from "node:url";

import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import {
  expect,
  expectAlertPush,
  expectLiveActivityPush,
  expectRelayGuardsOwner,
  field,
  freePort,
  makePhone,
  makeRelayRequests,
  OWNER_USER_ID,
  parseJson,
  prepare,
  promise,
  randomToken,
  startComposeStack,
  startFakeApns,
  stringField,
  toJson,
} from "./owner-mode-smoke.ts";

const USAGE = `Proves owner mode with the real pieces joined up: the Node relay in Docker, the built server CLI
linking and publishing through a local TLS proxy, and a script playing the phone. Only Apple's push
server is a fake.

  node scripts/owner-mode-e2e.ts
      Builds the server CLI, starts docker-compose.yml with throwaway keys, runs the check, removes it all.

  node scripts/owner-mode-e2e.ts --cli <path to bin.mjs>
      Uses a server CLI that is already built.`;

const RELAY_DIR = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const REPO_DIR = NodePath.resolve(RELAY_DIR, "../..");
const SERVER_DIR = NodePath.join(REPO_DIR, "apps/server");
// A free ACP agent that replays recorded turns, so the server runs a real turn without a paid model.
const REPLAY_AGENT = NodePath.join(SERVER_DIR, "scripts/dev-replay-agent.ts");
const CLI_TIMEOUT_MS = 180_000;
const SERVER_WAIT = "3 minutes";

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  /** Both streams, for failure details and the check that no secret was printed. */
  readonly output: string;
  /** What a person running the command reads: its answer, plus its logs only when it failed. */
  readonly shown: string;
}

const withoutNodeNoise = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/ExperimentalWarning|--trace-warnings|SQLite checkpoint worker/u.test(line))
    .join("\n")
    .trim();

/** Drops the server's own log entries, each a timestamped line with indented details, from a command's answer. */
const withoutLogEntries = (text: string) =>
  withoutNodeNoise(text.replace(/^\[\d\d:\d\d:\d\d\.\d+\] .*\n(?:[ \t}\]].*\n)*/gmu, ""));

const capture = (
  step: string,
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: Record<string, string> },
) =>
  promise(
    step,
    () =>
      new Promise<CliResult>((resolve, reject) => {
        const child = NodeChildProcess.spawn(command, args, {
          ...options,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: CLI_TIMEOUT_MS,
        });
        let stdout = "";
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          output += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        child.once("error", reject);
        child.once("exit", (code) =>
          resolve({
            code,
            stdout,
            output: withoutNodeNoise(output),
            shown: withoutLogEntries(code === 0 ? stdout : output),
          }),
        );
      }),
  );

const flag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

/** Terminates TLS for the relay's loopback port, as the proxy in front of a deployed relay does. */
const startTlsProxy = Effect.fn("e2e.startTlsProxy")(function* (input: {
  readonly dir: string;
  readonly port: number;
  readonly relayPort: number;
}) {
  const server = NodeHttps.createServer(
    {
      key: NodeFS.readFileSync(NodePath.join(input.dir, "apns-key.pem")),
      cert: NodeFS.readFileSync(NodePath.join(input.dir, "apns-cert.pem")),
    },
    (request, response) => {
      const upstream = NodeHttp.request(
        {
          host: "127.0.0.1",
          port: input.relayPort,
          method: request.method,
          path: request.url,
          headers: request.headers,
        },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(response);
        },
      );
      upstream.once("error", () => response.writeHead(502).end());
      request.pipe(upstream);
    },
  );
  yield* Effect.acquireRelease(
    promise(
      "start the TLS proxy",
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(input.port, "127.0.0.1", () => resolve());
        }),
    ),
    () =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
  );
});

const main = Effect.gen(function* () {
  if (process.argv.includes("--help")) return yield* Console.log(USAGE);
  // Outside the repository, so no key, token or server state can be committed.
  const dir = yield* Effect.acquireRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gs-connect-e2e-"))),
    (created) => Effect.sync(() => NodeFS.rmSync(created, { recursive: true, force: true })),
  );
  const relayPort = yield* freePort("pick a port for the relay");
  const proxyPort = yield* freePort("pick a port for the TLS proxy");
  const publicOrigin = `https://localhost:${proxyPort}`;
  const prepared = yield* prepare({
    dir,
    apnsHost: "host.docker.internal",
    hostPorts: { relay: relayPort, postgres: yield* freePort("pick a port for Postgres") },
    publicOrigin,
  });
  const certPath = NodePath.join(dir, "apns-cert.pem");
  // The phone role in this process dials the proxy too, so it must trust the throwaway certificate.
  NodeTls.setDefaultCACertificates([
    ...NodeTls.getCACertificates("default"),
    NodeFS.readFileSync(certPath, "utf8"),
  ]);

  // The server and CLI see no inherited T3CODE_* or VITE_* setting and never the real home directory.
  const home = NodePath.join(dir, "home");
  const project = NodePath.join(dir, "project");
  NodeFS.mkdirSync(home);
  NodeFS.mkdirSync(project);
  const hostEnv = yield* HostProcess.Environment;
  const cliEnv = {
    HOME: home,
    PATH: hostEnv.PATH ?? "",
    // A login zsh with no dotfiles waits on its first-run prompt.
    SHELL: "/bin/sh",
    T3CODE_RELAY_URL: publicOrigin,
    NODE_EXTRA_CA_CERTS: certPath,
  };
  const builtCli = flag("--cli");
  if (builtCli === undefined) {
    yield* Console.log("Building the server CLI (vp pack in apps/server)");
    const build = yield* capture("build the server CLI", "vp", ["pack"], {
      cwd: SERVER_DIR,
      env: Object.fromEntries(
        Object.entries(hostEnv).flatMap(([name, value]) =>
          value === undefined || /^(?:T3CODE_|VITE_)/u.test(name) ? [] : [[name, value]],
        ),
      ),
    });
    yield* expect("build the server CLI", build.code === 0, build.output.slice(-2_000));
  }
  const cliPath = NodePath.resolve(builtCli ?? NodePath.join(SERVER_DIR, "dist/bin.mjs"));
  const gs = Effect.fn("e2e.gs")(function* (
    baseDir: string,
    args: ReadonlyArray<string>,
    options: { readonly ownerToken?: string; readonly relayUrl?: string } = {},
  ) {
    const step = `gs ${args.join(" ")}`;
    const result = yield* capture(
      step,
      process.execPath,
      [cliPath, ...args, "--base-dir", baseDir],
      {
        cwd: project,
        env: {
          ...cliEnv,
          ...(options.ownerToken ? { GRADESPACE_CONNECT_OWNER_TOKEN: options.ownerToken } : {}),
          ...(options.relayUrl ? { T3CODE_RELAY_URL: options.relayUrl } : {}),
        },
      },
    );
    yield* Console.log(`$ ${step}  (exit ${result.code})\n${result.shown}`);
    yield* expect(
      step,
      [prepared.state.ownerToken, options.ownerToken].every(
        (token) => token === undefined || !result.output.includes(token),
      ),
      "the command printed the owner token",
    );
    return result;
  });
  const status = Effect.fn("e2e.status")(function* (baseDir: string) {
    const { stdout } = yield* gs(baseDir, ["connect", "status", "--json"]);
    return parseJson(stdout.slice(Math.max(0, stdout.search(/^\{/mu))));
  });

  /** Runs `gs serve` until the scope closes, and waits for lines in its log. */
  const serve = Effect.fn("e2e.serve")(function* (baseDir: string) {
    const port = yield* freePort("pick a port for the server");
    const chunks = yield* Queue.unbounded<string>();
    let log = "";
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        NodeChildProcess.spawn(
          process.execPath,
          [cliPath, "serve", "--base-dir", baseDir, "--port", String(port)],
          { cwd: project, env: cliEnv, stdio: ["ignore", "pipe", "pipe"] },
        ),
      ),
      (started) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              if (started.exitCode !== null) return resolve();
              started.once("exit", () => resolve());
              started.kill("SIGTERM");
            }),
        ),
    );
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk: Buffer) => {
        log += chunk.toString("utf8");
        Queue.offerUnsafe(chunks, "");
      });
    }
    child.once("exit", () => Queue.offerUnsafe(chunks, ""));
    yield* Console.log(`$ gs serve --port ${port}  (pid ${child.pid})`);
    const waitForLog = Effect.fn("e2e.waitForLog")(function* (step: string, message: string) {
      // A log line's details follow it, indented.
      const entry = () => {
        const lines = withoutNodeNoise(log).split("\n");
        const at = lines.findIndex((line) => line.includes(message));
        const details = lines.slice(at + 1).findIndex((line) => !/^[\s}]/u.test(line));
        return at === -1 ? null : lines.slice(at, details === -1 ? undefined : at + 1 + details);
      };
      yield* Effect.suspend(() => (entry() === null ? Queue.take(chunks) : Effect.void)).pipe(
        Effect.repeat({ until: () => entry() !== null || child.exitCode !== null }),
        Effect.timeoutOrElse({ duration: SERVER_WAIT, orElse: () => Effect.void }),
      );
      const found = entry();
      yield* expect(step, found !== null, `server log:\n${withoutNodeNoise(log).slice(-3_000)}`);
      yield* Console.log((found ?? []).join("\n"));
    });
    return { waitForLog };
  });

  const apns = yield* startFakeApns(prepared);
  yield* startComposeStack(prepared);
  yield* startTlsProxy({ dir, port: proxyPort, relayPort });
  const relay = yield* makeRelayRequests(publicOrigin);
  yield* expectRelayGuardsOwner(relay);

  // The link command asks the relay about the token, so a wrong one or a dead relay stops there.
  yield* Console.log("\n--- server CLI with a WRONG owner token, then an unreachable relay ---");
  const refusedBase = NodePath.join(dir, "base-refused");
  for (const refusal of [
    { ownerToken: randomToken(), says: "rejected this owner token" },
    {
      ownerToken: prepared.state.ownerToken,
      relayUrl: `https://localhost:${yield* freePort("pick a port nothing listens on")}`,
      says: "Could not check the owner token",
    },
  ]) {
    const refused = yield* gs(refusedBase, ["connect", "link", "--publish-only"], refusal);
    yield* expect(
      `the link command says: ${refusal.says}`,
      refused.code !== 0 && refused.output.includes(refusal.says),
      refused.output,
    );
  }
  const refusedStatus = yield* status(refusedBase);
  yield* expect(
    "a refused token is not stored",
    field(refusedStatus, "authenticated") === false &&
      field(refusedStatus, "desired") === false &&
      field(refusedStatus, "linked") === false,
    toJson(refusedStatus),
  );
  yield* Console.log("ok  the link command refuses both and stores nothing");

  // The real server: link with the owner token, start, and wait for the relay to accept its proof.
  yield* Console.log("\n--- server with the owner token ---");
  const baseDir = NodePath.join(dir, "base");
  const linked = yield* gs(baseDir, ["connect", "link", "--publish-only"], {
    ownerToken: prepared.state.ownerToken,
  });
  yield* expect("gs connect link --publish-only", linked.code === 0, linked.output);
  NodeFS.writeFileSync(
    NodePath.join(baseDir, "userdata/settings.json"),
    toJson({
      providerInstances: {
        devReplay: {
          driver: "acpRegistry",
          displayName: "Replay (dev)",
          config: { source: "local", commandPath: process.execPath, commandArgs: [REPLAY_AGENT] },
        },
      },
    }),
  );
  yield* gs(baseDir, ["project", "add", project]);
  const server = yield* serve(baseDir);
  yield* server.waitForLog(
    "the server links on startup",
    "T3 Connect desired link reconciled on startup",
  );
  const linkedStatus = yield* status(baseDir);
  yield* expect(
    "gs connect status reports the link",
    field(linkedStatus, "linked") === true &&
      field(linkedStatus, "cloudUserId") === OWNER_USER_ID &&
      field(linkedStatus, "relayUrl") === publicOrigin &&
      field(linkedStatus, "linkMode") === "publish_only" &&
      field(linkedStatus, "publishAgentActivity") === true,
    toJson(linkedStatus),
  );
  const environmentId = NodeFS.readFileSync(
    NodePath.join(baseDir, "userdata/environment-id"),
    "utf8",
  ).trim();
  yield* Console.log(`ok  the relay accepted the server's link proof for ${environmentId}`);

  const startThread = Effect.fn("e2e.startThread")(function* (scenario: string) {
    const started = yield* gs(baseDir, [
      "thread",
      "start",
      "--provider",
      "devReplay",
      "--model",
      scenario,
      "--json",
      project,
      "go",
    ]);
    yield* expect(`start a ${scenario} thread`, started.code === 0, started.output);
    return yield* stringField(
      `start a ${scenario} thread`,
      parseJson(started.stdout.slice(Math.max(0, started.stdout.search(/^\{/mu)))),
      "threadId",
    );
  });

  yield* Console.log("\n--- phone, then real turns through the server ---");
  const phone = yield* makePhone({ relay, publicOrigin, ownerToken: prepared.state.ownerToken });
  yield* phone.registerDevice;
  const expected = { apns, state: prepared.state, environmentId };
  // With no Live Activity yet, a turn that needs the owner or finishes must reach the phone as an alert.
  yield* expectAlertPush({
    ...expected,
    pushToken: phone.pushToken,
    threadId: yield* startThread("approval"),
  });
  yield* phone.registerLiveActivity;
  yield* expectLiveActivityPush({
    ...expected,
    activityPushToken: phone.activityPushToken,
    threadId: yield* startThread("showcase"),
  });
  yield* Console.log(
    "PASS  the real server linked, published a turn, and the relay sent the alert and the liveactivity push",
  );
}).pipe(
  Effect.scoped,
  Effect.provide(Layer.merge(NodeCryptoLayer.layerSignature, FetchHttpClient.layer)),
);

if (import.meta.main) NodeRuntime.runMain(main);
