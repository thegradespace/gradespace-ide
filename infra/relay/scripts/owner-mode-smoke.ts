// @effect-diagnostics nodeBuiltinImport:off - This developer command runs Docker, an HTTP/2 fake of Apple's push server and throwaway keys.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp2 from "node:http2";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type {
  RelayAgentActivityPublishProofPayload,
  RelayAgentActivityPublishRequest,
  RelayAgentActivityState,
  RelayDeviceRegistrationRequest,
  RelayEnvironmentLinkChallengeRequest,
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkRequest,
  RelayLiveActivityRegistrationRequest,
} from "@t3tools/contracts/relay";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  normalizeRelayIssuer,
  RELAY_ACTIVITY_PUBLISH_TYP,
  RELAY_LINK_PROOF_TYP,
  signRelayJwt,
} from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const USAGE = `Checks the Node relay in owner mode end to end, with a fake of Apple's push server.

  node scripts/owner-mode-smoke.ts
      Builds and starts docker-compose.yml with throwaway keys, runs the check, removes the stack.

  node scripts/owner-mode-smoke.ts --prepare <dir>
      Writes throwaway keys and <dir>/relay.env for a relay you start yourself with Node.

  node scripts/owner-mode-smoke.ts --state <dir> --relay-url <url>
      Runs the check against the relay you started from <dir>/relay.env.`;

const RELAY_DIR = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
// The relay must answer for this origin although the test reaches it on a loopback port, as it would behind a TLS proxy.
const PUBLIC_ORIGIN = "https://connect.smoke.test";
const OWNER_USER_ID = "owner-smoke";
const APNS_TEAM_ID = "SMOKETEAM1";
const APNS_KEY_ID = "SMOKEKEY01";
const RELAY_DEFAULT_BUNDLE_ID = "com.example.smoke";
// Differs from the relay's default so the check proves the topic follows the device.
const DEVICE_BUNDLE_ID = "com.example.smoke.dev";
const PUSH_WAIT = "20 seconds";
const STACK_START_TIMEOUT_MS = 30 * 60_000;

class SmokeFailed extends Schema.TaggedError<SmokeFailed>()("SmokeFailed", {
  step: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.step}: ${this.detail}`;
  }
}

const SmokeState = Schema.Struct({
  ownerToken: Schema.String,
  apnsPort: Schema.Int,
  apnsPublicKeyPem: Schema.String,
});
type SmokeState = typeof SmokeState.Type;
const SmokeStateJson = Schema.fromJsonString(SmokeState);
const decodeState = Schema.decodeUnknownEffect(SmokeStateJson);
const encodeState = Schema.encodeSync(SmokeStateJson);
const UnknownJson = Schema.fromJsonString(Schema.Unknown);
const toJson = Schema.encodeSync(UnknownJson);
const decodeJson = Schema.decodeOption(UnknownJson);
const parseJson = (text: string): unknown => Option.getOrElse(decodeJson(text), () => text);

const promise = <A>(step: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new SmokeFailed({ step, detail: cause instanceof Error ? cause.message : String(cause) }),
  });

const expect = (step: string, condition: boolean, detail: string) =>
  condition ? Effect.void : Effect.fail(new SmokeFailed({ step, detail }));

const base64Url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");
const oneLine = (pem: string) => pem.trim().replace(/\n/gu, "\\n");
const randomToken = () => NodeCrypto.randomBytes(32).toString("base64url");
const randomDeviceToken = () => NodeCrypto.randomBytes(32).toString("hex");

const freePort = (step: string) =>
  promise(
    step,
    () =>
      new Promise<number>((resolve, reject) => {
        const server = NodeNet.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          server.close(() =>
            typeof address === "object" && address !== null
              ? resolve(address.port)
              : reject(new Error("no port")),
          );
        });
      }),
  );

const run = (
  step: string,
  command: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
  output: "inherit" | "ignore" = "inherit",
) =>
  promise(
    step,
    () =>
      new Promise<void>((resolve, reject) => {
        const child = NodeChildProcess.spawn(command, args, {
          stdio: ["ignore", output, output],
          timeout: timeoutMs,
        });
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
        );
      }),
  );

interface PreparedState {
  readonly dir: string;
  readonly state: SmokeState;
}

/** Writes the keys, the fake APNs certificate and the relay's environment file. Nothing here is reused outside the run. */
const prepare = Effect.fn("smoke.prepare")(function* (input: {
  readonly dir: string;
  /** Host name the relay reaches the fake APNs by: the Docker host from a container, loopback otherwise. */
  readonly apnsHost: string;
  /** Compose reads its published ports from the same file as the relay's settings. */
  readonly hostPorts?: { readonly relay: number; readonly postgres: number };
}) {
  NodeFS.mkdirSync(input.dir, { recursive: true, mode: 0o700 });
  const apnsPort = yield* freePort("pick a port for the fake APNs");
  const certPath = NodePath.join(input.dir, "apns-cert.pem");
  yield* run(
    "create the fake APNs certificate",
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=fake-apns",
      "-addext",
      "subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1",
      "-keyout",
      NodePath.join(input.dir, "apns-key.pem"),
      "-out",
      certPath,
    ],
    60_000,
    "ignore",
  );
  const mint = NodeCrypto.generateKeyPairSync("ed25519");
  const apns = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const state: SmokeState = {
    ownerToken: randomToken(),
    apnsPort,
    apnsPublicKeyPem: apns.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  const env = {
    RELAY_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    RELAY_AUTH_MODE: "owner",
    RELAY_OWNER_TOKEN: state.ownerToken,
    RELAY_OWNER_USER_ID: OWNER_USER_ID,
    RELAY_MINT_PRIVATE_KEY: oneLine(
      mint.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ),
    RELAY_JOB_SIGNING_SECRET: randomToken(),
    APNS_ENVIRONMENT: "sandbox",
    APNS_TEAM_ID,
    APNS_KEY_ID,
    APNS_BUNDLE_ID: RELAY_DEFAULT_BUNDLE_ID,
    APNS_PRIVATE_KEY: oneLine(apns.privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
    APNS_BASE_URL: `https://${input.apnsHost}:${apnsPort}`,
    POSTGRES_PASSWORD: NodeCrypto.randomBytes(18).toString("hex"),
    ...(input.hostPorts
      ? {
          RELAY_HOST_PORT: String(input.hostPorts.relay),
          POSTGRES_HOST_PORT: String(input.hostPorts.postgres),
        }
      : {}),
  };
  NodeFS.writeFileSync(
    NodePath.join(input.dir, "relay.env"),
    `${Object.entries(env)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  NodeFS.writeFileSync(NodePath.join(input.dir, "state.json"), encodeState(state), {
    mode: 0o600,
  });
  return { dir: input.dir, state } satisfies PreparedState;
});

interface ReceivedPush {
  readonly path: string;
  readonly headers: NodeHttp2.IncomingHttpHeaders;
  readonly body: unknown;
}

/** Stands in for api.sandbox.push.apple.com: HTTP/2 over TLS only, like Apple. */
const startFakeApns = Effect.fn("smoke.startFakeApns")(function* (prepared: PreparedState) {
  const arrivals = yield* Queue.unbounded<ReceivedPush>();
  // A container reaches a Linux host through the bridge address, not loopback.
  const listenHost = (yield* HostProcess.Platform) === "linux" ? "0.0.0.0" : "127.0.0.1";
  const seen: Array<ReceivedPush> = [];
  const sessions = new Set<NodeHttp2.ServerHttp2Session>();
  const server = NodeHttp2.createSecureServer({
    key: NodeFS.readFileSync(NodePath.join(prepared.dir, "apns-key.pem")),
    cert: NodeFS.readFileSync(NodePath.join(prepared.dir, "apns-cert.pem")),
    allowHTTP1: false,
  });
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });
  server.on("stream", (stream, headers) => {
    const chunks: Array<Buffer> = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const push = {
        path: String(headers[":path"]),
        headers,
        body: parseJson(Buffer.concat(chunks).toString("utf8")),
      };
      seen.push(push);
      stream.respond({ ":status": 200, "apns-id": NodeCrypto.randomUUID() });
      stream.end();
      Queue.offerUnsafe(arrivals, push);
    });
  });
  yield* Effect.acquireRelease(
    promise(
      "start the fake APNs",
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(prepared.state.apnsPort, listenHost, () => resolve());
        }),
    ),
    () =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            // The relay keeps its HTTP/2 session open, and the listener waits for sessions to end.
            for (const session of sessions) session.destroy();
            server.close(() => resolve());
          }),
      ),
  );
  // Expectations arrive in order, so earlier pushes that do not match are passed over.
  const waitFor = (step: string, match: (push: ReceivedPush) => boolean) =>
    Queue.take(arrivals).pipe(
      Effect.repeat({ until: match }),
      Effect.timeoutOrElse({
        duration: PUSH_WAIT,
        orElse: () =>
          Effect.fail(
            new SmokeFailed({
              step,
              detail: `no matching push within ${PUSH_WAIT}; the fake APNs saw ${toJson(
                seen.map((push) => [push.headers["apns-push-type"], push.path.slice(-8)]),
              )}`,
            }),
          ),
      }),
    );
  return { waitFor };
});

const startComposeStack = Effect.fn("smoke.startComposeStack")(function* (prepared: PreparedState) {
  const project = `gs-connect-smoke-${NodeCrypto.randomBytes(4).toString("hex")}`;
  const override = NodePath.join(prepared.dir, "smoke.compose.yml");
  NodeFS.writeFileSync(
    override,
    [
      "services:",
      "  relay:",
      "    environment:",
      "      NODE_EXTRA_CA_CERTS: /smoke/apns-cert.pem",
      "    volumes:",
      `      - ${toJson(`${NodePath.join(prepared.dir, "apns-cert.pem")}:/smoke/apns-cert.pem:ro`)}`,
      "    extra_hosts:",
      '      - "host.docker.internal:host-gateway"',
      "",
    ].join("\n"),
  );
  const compose = (...args: ReadonlyArray<string>) => [
    "compose",
    "--project-name",
    project,
    "--file",
    NodePath.join(RELAY_DIR, "docker-compose.yml"),
    "--file",
    override,
    "--env-file",
    NodePath.join(prepared.dir, "relay.env"),
    ...args,
  ];
  yield* Effect.acquireRelease(
    Console.log(`Starting compose project ${project} (first build can take several minutes)`),
    () =>
      run(
        "remove the compose stack",
        "docker",
        compose("down", "--volumes", "--remove-orphans"),
        120_000,
      ).pipe(
        Effect.andThen(Console.log(`Removed compose project ${project} and its volumes`)),
        Effect.catch((error) => Console.error(`Could not remove ${project}: ${error.message}`)),
      ),
  );
  yield* run(
    "start the compose stack",
    "docker",
    compose("up", "--detach", "--build", "--wait"),
    STACK_START_TIMEOUT_MS,
  ).pipe(
    Effect.tapError(() =>
      run("show relay logs", "docker", compose("logs", "--tail", "60", "relay"), 30_000).pipe(
        Effect.ignore,
      ),
    ),
  );
});

interface JsonResponse {
  readonly status: number;
  readonly json: unknown;
}

const field = (value: unknown, ...path: ReadonlyArray<string>): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      typeof current === "object" && current !== null ? Reflect.get(current, key) : undefined,
    value,
  );

const stringField = (step: string, value: unknown, ...path: ReadonlyArray<string>) => {
  const found = field(value, ...path);
  return typeof found === "string" && found.length > 0
    ? Effect.succeed(found)
    : Effect.fail(new SmokeFailed({ step, detail: `response has no ${path.join(".")}` }));
};

/** Plays the T3 server and the phone against the relay, then checks what reached the fake APNs. */
const check = Effect.fn("smoke.check")(function* (input: {
  readonly relayUrl: string;
  readonly state: SmokeState;
  readonly apns: Effect.Success<ReturnType<typeof startFakeApns>>;
}) {
  const issuer = normalizeRelayIssuer(PUBLIC_ORIGIN);
  const http = yield* HttpClient.HttpClient;
  const request = (
    step: string,
    path: string,
    init: {
      readonly method?: "GET" | "POST";
      readonly headers: Record<string, string>;
      readonly form?: Record<string, string>;
      readonly json?: unknown;
    },
  ) =>
    HttpClientRequest.make(init.method ?? "POST")(`${input.relayUrl}${path}`).pipe(
      HttpClientRequest.setHeaders(init.headers),
      init.form !== undefined
        ? HttpClientRequest.bodyUrlParams(init.form)
        : init.json !== undefined
          ? HttpClientRequest.bodyText(toJson(init.json), "application/json")
          : (unchanged) => unchanged,
      http.execute,
      Effect.flatMap((response) =>
        Effect.map(response.text, (text): JsonResponse => ({
          status: response.status,
          json: parseJson(text),
        })),
      ),
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) => new SmokeFailed({ step, detail: String(cause) })),
    );
  const ok = (step: string, response: JsonResponse) =>
    expect(step, response.status === 200, `HTTP ${response.status} ${toJson(response.json)}`).pipe(
      Effect.as(response.json),
    );
  const nowSeconds = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1_000));

  yield* expect(
    "relay health",
    (yield* request("relay health", "/health", { method: "GET", headers: {} })).status === 200,
    "the relay did not report healthy",
  );
  const stranger = yield* request("reject a wrong owner token", "/v1/environments", {
    method: "GET",
    headers: { authorization: `Bearer ${randomToken()}` },
  });
  yield* expect(
    "reject a wrong owner token",
    stranger.status === 401,
    `expected 401, got ${stranger.status}`,
  );
  yield* Console.log("ok  relay is healthy and refuses a wrong owner token");

  // The T3 server: link this environment with the owner token.
  const environmentId = EnvironmentId.make(
    `env-smoke-${NodeCrypto.randomBytes(4).toString("hex")}`,
  );
  const environmentKey = NodeCrypto.generateKeyPairSync("ed25519");
  const environmentPrivateKey = environmentKey.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const environmentPublicKey = environmentKey.publicKey
    .export({ type: "spki", format: "pem" })
    .toString()
    .trim();
  const owner = { authorization: `Bearer ${input.state.ownerToken}` };
  const capabilities = {
    notificationsEnabled: true,
    liveActivitiesEnabled: true,
    managedTunnelsEnabled: false,
  } satisfies RelayEnvironmentLinkChallengeRequest;
  const challenge = yield* stringField(
    "request a link challenge",
    yield* ok(
      "request a link challenge",
      yield* request("request a link challenge", "/v1/client/environment-link-challenges", {
        headers: owner,
        json: capabilities,
      }),
    ),
    "challenge",
  );
  const linkedAt = yield* nowSeconds;
  const linkProof = yield* signRelayJwt({
    privateKey: environmentPrivateKey,
    typ: RELAY_LINK_PROOF_TYP,
    payload: {
      iss: `t3-env:${environmentId}`,
      aud: issuer,
      sub: environmentId,
      jti: NodeCrypto.randomUUID(),
      iat: linkedAt,
      exp: linkedAt + 300,
      challenge,
      descriptor: {
        environmentId,
        label: "Smoke server",
        platform: { os: "darwin", arch: "x64" },
        serverVersion: "0.0.0-smoke",
        capabilities: { repositoryIdentity: false },
      },
      environmentId,
      environmentPublicKey,
      endpoint: {
        httpBaseUrl: "http://127.0.0.1:3773",
        wsBaseUrl: "ws://127.0.0.1:3773",
        providerKind: "manual",
      },
      origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      scopes: ["agent_activity_notifications"],
    } satisfies RelayEnvironmentLinkProofPayload,
  }).pipe(
    Effect.mapError(
      (error) => new SmokeFailed({ step: "sign the link proof", detail: error.message }),
    ),
  );
  const link = yield* ok(
    "link the environment",
    yield* request("link the environment", "/v1/client/environment-links", {
      headers: owner,
      json: { proof: linkProof, ...capabilities } satisfies RelayEnvironmentLinkRequest,
    }),
  );
  const environmentCredential = yield* stringField(
    "link the environment",
    link,
    "environmentCredential",
  );
  yield* expect(
    "link the environment",
    field(link, "cloudUserId") === OWNER_USER_ID && field(link, "relayIssuer") === PUBLIC_ORIGIN,
    `linked as ${toJson([field(link, "cloudUserId"), field(link, "relayIssuer")])}`,
  );
  yield* Console.log(`ok  server linked ${environmentId} as user ${OWNER_USER_ID}`);

  const publish = Effect.fn("smoke.publish")(function* (
    step: string,
    thread: string,
    phase: RelayAgentActivityState["phase"],
    headline: string,
  ) {
    const threadId = ThreadId.make(thread);
    const state = {
      environmentId,
      threadId,
      projectTitle: "Smoke project",
      threadTitle: `Smoke ${thread}`,
      phase,
      headline,
      modelTitle: "smoke-model",
      updatedAt: DateTime.formatIso(yield* DateTime.now),
      deepLink: `/threads/${environmentId}/${thread}`,
    } satisfies RelayAgentActivityState;
    const issuedAt = yield* nowSeconds;
    const proof = yield* signRelayJwt({
      privateKey: environmentPrivateKey,
      typ: RELAY_ACTIVITY_PUBLISH_TYP,
      payload: {
        iss: `t3-env:${environmentId}`,
        aud: issuer,
        sub: environmentId,
        jti: NodeCrypto.randomUUID(),
        iat: issuedAt,
        exp: issuedAt + 300,
        environmentId,
        threadId,
        state,
      } satisfies RelayAgentActivityPublishProofPayload,
    }).pipe(Effect.mapError((error) => new SmokeFailed({ step, detail: error.message })));
    return yield* ok(
      step,
      yield* request(
        step,
        `/v1/environments/${environmentId}/threads/${encodeURIComponent(thread)}/agent-activity`,
        {
          headers: { authorization: `Bearer ${environmentCredential}` },
          json: { state, proof } satisfies RelayAgentActivityPublishRequest,
        },
      ),
    );
  });

  // The phone: exchange the owner token for a DPoP-bound token, then register.
  const phoneKey = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const phoneJwk = phoneKey.publicKey.export({ format: "jwk" });
  const dpopProof = Effect.fn("smoke.dpopProof")(function* (
    method: string,
    path: string,
    accessToken?: string,
  ) {
    const header = base64Url(
      toJson({
        typ: "dpop+jwt",
        alg: "ES256",
        jwk: { kty: "EC", crv: "P-256", x: phoneJwk.x, y: phoneJwk.y },
      }),
    );
    const payload = base64Url(
      toJson({
        htm: method,
        // Signed for the public URL, never for the loopback address the test dials.
        htu: `${PUBLIC_ORIGIN}${path}`,
        jti: NodeCrypto.randomUUID(),
        iat: yield* nowSeconds,
        ...(accessToken
          ? { ath: NodeCrypto.createHash("sha256").update(accessToken).digest("base64url") }
          : {}),
      }),
    );
    const signature = NodeCrypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
      key: phoneKey.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    return `${header}.${payload}.${base64Url(signature)}`;
  });
  const accessToken = yield* stringField(
    "exchange the owner token",
    yield* ok(
      "exchange the owner token",
      yield* request("exchange the owner token", "/v1/client/dpop-token", {
        headers: { dpop: yield* dpopProof("POST", "/v1/client/dpop-token") },
        form: {
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token: input.state.ownerToken,
          subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
          resource: issuer,
          scope: "mobile:registration",
          client_id: "t3-mobile",
        },
      }),
    ),
    "access_token",
  );
  yield* Console.log("ok  phone exchanged the owner token for a DPoP access token");

  const phone = Effect.fn("smoke.phone")(function* (step: string, path: string, json: unknown) {
    return yield* ok(
      step,
      yield* request(step, path, {
        headers: {
          authorization: `DPoP ${accessToken}`,
          dpop: yield* dpopProof("POST", path, accessToken),
        },
        json,
      }),
    );
  });
  const deviceId = `device-smoke-${NodeCrypto.randomBytes(4).toString("hex")}`;
  const pushToken = randomDeviceToken();
  const activityPushToken = randomDeviceToken();
  yield* phone("register the device", "/v1/mobile/devices", {
    deviceId,
    label: "Smoke iPhone",
    platform: "ios",
    iosMajorVersion: 18,
    appVersion: "0.0.0-smoke",
    bundleId: DEVICE_BUNDLE_ID,
    apsEnvironment: "sandbox",
    pushToken,
    preferences: {
      liveActivitiesEnabled: true,
      notificationsEnabled: true,
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
    },
  } satisfies RelayDeviceRegistrationRequest);
  yield* Console.log(`ok  phone registered ${deviceId}`);

  const verifyProviderToken = Effect.fn("smoke.verifyProviderToken")(function* (
    step: string,
    push: ReceivedPush,
  ) {
    {
      const authorization = String(push.headers.authorization ?? "");
      const [scheme, jwt] = authorization.split(" ");
      const [header, payload, signature] = (jwt ?? "").split(".");
      yield* expect(
        step,
        scheme === "bearer" && Boolean(header && payload && signature),
        "no bearer JWT",
      );
      const decode = (segment: string | undefined): unknown =>
        parseJson(Buffer.from(segment ?? "", "base64url").toString("utf8"));
      yield* expect(
        step,
        field(decode(header), "alg") === "ES256" &&
          field(decode(header), "kid") === APNS_KEY_ID &&
          field(decode(payload), "iss") === APNS_TEAM_ID,
        `provider token claims are ${toJson([decode(header), decode(payload)])}`,
      );
      yield* expect(
        step,
        NodeCrypto.verify(
          "sha256",
          Buffer.from(`${header}.${payload}`),
          { key: input.state.apnsPublicKeyPem, dsaEncoding: "ieee-p1363" },
          Buffer.from(signature ?? "", "base64url"),
        ),
        "provider token is not signed by the relay's APNs key",
      );
    }
  });

  // An agent asks for approval: with no Live Activity yet, the phone must get an alert.
  yield* publish(
    "publish an approval request",
    "thread-approval",
    "waiting_for_approval",
    "Needs approval",
  );
  const alert = yield* input.apns.waitFor(
    "alert push reaches the fake APNs",
    (push) => push.path === `/3/device/${pushToken}`,
  );
  yield* expect(
    "alert push headers",
    alert.headers[":method"] === "POST" &&
      alert.headers["apns-push-type"] === "alert" &&
      alert.headers["apns-topic"] === DEVICE_BUNDLE_ID &&
      alert.headers["apns-priority"] === "10",
    toJson(alert.headers),
  );
  yield* verifyProviderToken("alert push provider token", alert);
  yield* expect(
    "alert push body",
    typeof field(alert.body, "aps", "alert", "title") === "string" &&
      field(alert.body, "body", "environmentId") === environmentId &&
      field(alert.body, "body", "threadId") === "thread-approval",
    toJson(alert.body),
  );
  yield* Console.log(
    `ok  alert push: apns-push-type=alert apns-topic=${alert.headers["apns-topic"]} apns-priority=${alert.headers["apns-priority"]}`,
  );

  // The phone starts a Live Activity, then another agent starts running.
  yield* phone("register the Live Activity", "/v1/mobile/live-activities", {
    deviceId,
    activityPushToken,
  } satisfies RelayLiveActivityRegistrationRequest);
  yield* publish("publish a running agent", "thread-running", "running", "Working");
  const liveActivity = yield* input.apns.waitFor(
    "liveactivity push reaches the fake APNs",
    (push) =>
      push.path === `/3/device/${activityPushToken}` &&
      String(field(push.body, "aps", "content-state", "props")).includes("thread-running"),
  );
  yield* expect(
    "liveactivity push headers",
    liveActivity.headers[":method"] === "POST" &&
      liveActivity.headers["apns-push-type"] === "liveactivity" &&
      liveActivity.headers["apns-topic"] === `${DEVICE_BUNDLE_ID}.push-type.liveactivity` &&
      (liveActivity.headers["apns-priority"] === "5" ||
        liveActivity.headers["apns-priority"] === "10"),
    toJson(liveActivity.headers),
  );
  yield* verifyProviderToken("liveactivity push provider token", liveActivity);
  yield* expect(
    "liveactivity push body",
    field(liveActivity.body, "aps", "event") === "update" &&
      typeof field(liveActivity.body, "aps", "timestamp") === "number",
    toJson(liveActivity.body),
  );
  yield* Console.log(
    `ok  liveactivity push: apns-push-type=liveactivity apns-topic=${liveActivity.headers["apns-topic"]} apns-priority=${liveActivity.headers["apns-priority"]} event=update`,
  );
});

const readState = Effect.fn("smoke.readState")(function* (dir: string) {
  const state = yield* Effect.try({
    try: () => NodeFS.readFileSync(NodePath.join(dir, "state.json"), "utf8"),
    catch: () =>
      new SmokeFailed({
        step: "read the state",
        detail: `${dir} has no state.json; run --prepare`,
      }),
  }).pipe(
    Effect.flatMap(decodeState),
    Effect.mapError((error) => new SmokeFailed({ step: "read the state", detail: error.message })),
  );
  return { dir, state } satisfies PreparedState;
});

const flag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const main = Effect.gen(function* () {
  if (process.argv.includes("--help")) return yield* Console.log(USAGE);
  const prepareDir = flag("--prepare");
  if (prepareDir !== undefined) {
    const dir = NodePath.resolve(prepareDir);
    const prepared = yield* prepare({ dir, apnsHost: "localhost" });
    return yield* Console.log(
      [
        `Wrote throwaway keys to ${prepared.dir}. Start a relay with them:`,
        `  DATABASE_URL=postgres://… RELAY_PORT=8787 NODE_EXTRA_CA_CERTS=${NodePath.join(dir, "apns-cert.pem")} \\`,
        `    node --env-file=${NodePath.join(dir, "relay.env")} src/node/main.ts`,
        `then run: node scripts/owner-mode-smoke.ts --state ${dir} --relay-url http://127.0.0.1:8787`,
      ].join("\n"),
    );
  }
  const stateDir = flag("--state");
  const relayUrl = flag("--relay-url");
  if ((stateDir === undefined) !== (relayUrl === undefined)) {
    return yield* new SmokeFailed({ step: "read the arguments", detail: `\n${USAGE}` });
  }
  if (stateDir !== undefined && relayUrl !== undefined) {
    const prepared = yield* readState(NodePath.resolve(stateDir));
    const apns = yield* startFakeApns(prepared);
    yield* check({ relayUrl: relayUrl.replace(/\/+$/u, ""), state: prepared.state, apns });
  } else {
    const dir = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gs-connect-smoke-"))),
      (created) => Effect.sync(() => NodeFS.rmSync(created, { recursive: true, force: true })),
    );
    const relayPort = yield* freePort("pick a port for the relay");
    const prepared = yield* prepare({
      dir,
      apnsHost: "host.docker.internal",
      hostPorts: { relay: relayPort, postgres: yield* freePort("pick a port for Postgres") },
    });
    const apns = yield* startFakeApns(prepared);
    yield* startComposeStack(prepared);
    yield* check({ relayUrl: `http://127.0.0.1:${relayPort}`, state: prepared.state, apns });
  }
  yield* Console.log("PASS  owner-mode relay delivered the alert and the liveactivity push");
}).pipe(
  Effect.scoped,
  Effect.provide(Layer.merge(NodeCryptoLayer.layerSignature, FetchHttpClient.layer)),
);

NodeRuntime.runMain(main);
