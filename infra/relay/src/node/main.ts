// @effect-diagnostics nodeBuiltinImport:off - The Node entry point owns the HTTP listener and checks PEM keys at boot.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeURL from "node:url";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpServer from "effect/http/HttpServer";

import * as RelayConfiguration from "../Config.ts";
import { makeHttpEffect, type NodeRelayOptions } from "./runtime.ts";

class RelayEnvInvalid extends Schema.TaggedError<RelayEnvInvalid>()("RelayEnvInvalid", {
  variable: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.variable} ${this.problem}`;
  }
}

// Effect's own error for a missing variable does not say which one.
const read = <A>(variable: string, config: (name: string) => Config.Config<A>) =>
  Effect.mapError(
    config(variable),
    () => new RelayEnvInvalid({ variable, problem: "is missing or not valid" }),
  );

// A guessable owner token or job-signing secret would let a stranger act as the owner or forge pushes.
const MIN_SECRET_LENGTH = 32;

const secret = Effect.fn("relay.node.config.secret")(function* (variable: string) {
  const value = yield* read(variable, Config.Redacted);
  if (Redacted.value(value).length < MIN_SECRET_LENGTH) {
    return yield* new RelayEnvInvalid({
      variable,
      problem: `must be at least ${MIN_SECRET_LENGTH} characters`,
    });
  }
  return value;
});

const privateKey = Effect.fn("relay.node.config.privateKey")(function* (
  variable: string,
  expected: { readonly keyType: "ed25519" } | { readonly keyType: "ec"; readonly curve: string },
) {
  const pem = yield* read(variable, Config.Redacted);
  const key = yield* Effect.try({
    try: () => NodeCrypto.createPrivateKey(Redacted.value(pem).replace(/\\n/gu, "\n")),
    catch: () => new RelayEnvInvalid({ variable, problem: "is not a PEM private key" }),
  });
  const matches =
    key.asymmetricKeyType === expected.keyType &&
    (expected.keyType !== "ec" || key.asymmetricKeyDetails?.namedCurve === expected.curve);
  if (!matches) {
    return yield* new RelayEnvInvalid({
      variable,
      problem: `must be ${expected.keyType === "ec" ? "a P-256" : "an Ed25519"} private key`,
    });
  }
  return { pem, key };
});

const loadAuth = Effect.gen(function* () {
  const mode = yield* read("RELAY_AUTH_MODE", (name) =>
    Config.schema(Schema.Literals(["owner", "clerk"]), name),
  );
  if (mode === "clerk") {
    return {
      mode,
      secretKey: yield* read("CLERK_SECRET_KEY", Config.Redacted),
      publishableKey: yield* read("CLERK_PUBLISHABLE_KEY", Config.String),
      jwtAudience: yield* read("CLERK_JWT_AUDIENCE", Config.String),
    } satisfies RelayConfiguration.ClerkAuthSettings;
  }
  const ownerUserId = yield* read("RELAY_OWNER_USER_ID", (name) =>
    Config.String(name).pipe(Config.withDefault("owner")),
  );
  // The id is a primary-key column (varchar 191) and travels in URLs and JWT claims.
  if (!/^[A-Za-z0-9_.:-]{1,191}$/u.test(ownerUserId)) {
    return yield* new RelayEnvInvalid({
      variable: "RELAY_OWNER_USER_ID",
      problem: "must be 1 to 191 letters, digits, or _ . : -",
    });
  }
  return {
    mode,
    ownerToken: yield* secret("RELAY_OWNER_TOKEN"),
    ownerUserId,
  } satisfies RelayConfiguration.OwnerAuthSettings;
});

const loadApns = Effect.gen(function* () {
  const enabled = yield* read("APNS_ENABLED", (name) =>
    Config.Boolean(name).pipe(Config.withDefault(true)),
  );
  if (!enabled) return null;
  return {
    environment: yield* read("APNS_ENVIRONMENT", (name) =>
      Config.schema(RelayConfiguration.ApnsEnvironment, name),
    ),
    teamId: yield* read("APNS_TEAM_ID", Config.NonEmptyString),
    keyId: yield* read("APNS_KEY_ID", Config.NonEmptyString),
    bundleId: yield* read("APNS_BUNDLE_ID", Config.NonEmptyString),
    privateKey: (yield* privateKey("APNS_PRIVATE_KEY", { keyType: "ec", curve: "prime256v1" })).pem,
  } satisfies RelayConfiguration.ApnsCredentials;
});

const loadOptions = Effect.gen(function* () {
  const publicOrigin = yield* read("RELAY_PUBLIC_ORIGIN", Config.URL);
  if (publicOrigin.origin !== publicOrigin.href.replace(/\/$/u, "")) {
    return yield* new RelayEnvInvalid({
      variable: "RELAY_PUBLIC_ORIGIN",
      problem: "must be an origin such as https://connect.example.com, with no path",
    });
  }
  const mint = yield* privateKey("RELAY_MINT_PRIVATE_KEY", { keyType: "ed25519" });
  return {
    configuration: {
      relayIssuer: publicOrigin.origin,
      apns: yield* loadApns,
      auth: yield* loadAuth,
      apnsDeliveryJobSigningSecret: yield* secret("RELAY_JOB_SIGNING_SECRET"),
      cloudMintPrivateKey: mint.pem,
      // Derived, so the verification key can never disagree with the signing key.
      cloudMintPublicKey: NodeCrypto.createPublicKey(mint.key)
        .export({ type: "spki", format: "pem" })
        .toString(),
      managedEndpointBaseDomain: undefined,
      managedEndpointNamespace: undefined,
    },
    databaseUrl: yield* read("DATABASE_URL", Config.Redacted),
    migrationsFolder: NodeURL.fileURLToPath(new URL("../../migrations/postgres", import.meta.url)),
    publicOrigin,
    // Compose passes unset variables as empty strings.
    apnsBaseUrl: Option.getOrUndefined(
      Option.filter(
        yield* read("APNS_BASE_URL", (name) => Config.option(Config.String(name))),
        (value) => value.trim().length > 0,
      ),
    ),
  } satisfies NodeRelayOptions;
});

const layerServer = Layer.unwrap(
  Effect.gen(function* () {
    return NodeHttpServer.layer(NodeHttp.createServer, {
      host: yield* read("RELAY_HOST", (name) =>
        Config.String(name).pipe(Config.withDefault("127.0.0.1")),
      ),
      port: yield* read("RELAY_PORT", (name) => Config.Port(name).pipe(Config.withDefault(8787))),
    });
  }),
);

const layerMain = Layer.unwrap(
  Effect.gen(function* () {
    const options = yield* loadOptions;
    yield* Effect.logInfo("Starting the relay", {
      publicOrigin: options.publicOrigin.origin,
      authMode: options.configuration.auth.mode,
      apns: options.configuration.apns === null ? "off" : options.configuration.apns.environment,
      apnsBaseUrl: options.apnsBaseUrl ?? "Apple",
    });
    return Layer.unwrap(Effect.map(makeHttpEffect(options), HttpServer.serve()));
  }),
).pipe(HttpServer.withLogAddress, Layer.provide(layerServer));

NodeRuntime.runMain(Layer.launch(layerMain));
