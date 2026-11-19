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

// A guessable owner token or job-signing secret would let a stranger act as the owner or forge pushes.
const MIN_SECRET_LENGTH = 32;

const secret = Effect.fn("relay.node.config.secret")(function* (variable: string) {
  const value = yield* Config.Redacted(variable);
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
  const pem = yield* Config.Redacted(variable);
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
  const mode = yield* Config.schema(Schema.Literals(["owner", "clerk"]), "RELAY_AUTH_MODE");
  if (mode === "clerk") {
    return {
      mode,
      secretKey: yield* Config.Redacted("CLERK_SECRET_KEY"),
      publishableKey: yield* Config.String("CLERK_PUBLISHABLE_KEY"),
      jwtAudience: yield* Config.String("CLERK_JWT_AUDIENCE"),
    } satisfies RelayConfiguration.ClerkAuthSettings;
  }
  const ownerUserId = yield* Config.String("RELAY_OWNER_USER_ID").pipe(Config.withDefault("owner"));
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
  if (!(yield* Config.Boolean("APNS_ENABLED").pipe(Config.withDefault(true)))) return null;
  return {
    environment: yield* Config.schema(RelayConfiguration.ApnsEnvironment, "APNS_ENVIRONMENT"),
    teamId: yield* Config.String("APNS_TEAM_ID"),
    keyId: yield* Config.String("APNS_KEY_ID"),
    bundleId: yield* Config.String("APNS_BUNDLE_ID"),
    privateKey: (yield* privateKey("APNS_PRIVATE_KEY", { keyType: "ec", curve: "prime256v1" })).pem,
  } satisfies RelayConfiguration.ApnsCredentials;
});

const loadOptions = Effect.gen(function* () {
  const publicOrigin = yield* Config.URL("RELAY_PUBLIC_ORIGIN");
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
    databaseUrl: yield* Config.Redacted("DATABASE_URL"),
    migrationsFolder: NodeURL.fileURLToPath(new URL("../../migrations/postgres", import.meta.url)),
    publicOrigin,
    // Compose passes unset variables as empty strings.
    apnsBaseUrl: Option.getOrUndefined(
      Option.filter(
        yield* Config.option(Config.String("APNS_BASE_URL")),
        (value) => value.trim().length > 0,
      ),
    ),
  } satisfies NodeRelayOptions;
});

const layerServer = Layer.unwrap(
  Effect.gen(function* () {
    return NodeHttpServer.layer(NodeHttp.createServer, {
      host: yield* Config.String("RELAY_HOST").pipe(Config.withDefault("127.0.0.1")),
      port: yield* Config.Port("RELAY_PORT").pipe(Config.withDefault(8787)),
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
