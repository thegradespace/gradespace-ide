import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import * as ByteSize from "effect/ByteSize";
import * as Cause from "effect/Cause";
import * as Digest from "effect/crypto/Digest";
import * as Mac from "effect/crypto/Mac";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Etag from "effect/http/Etag";
import * as Headers from "effect/http/Headers";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { RelayApi } from "@t3tools/contracts/relay";

import * as AgentActivityPublisher from "../agentActivity/AgentActivityPublisher.ts";
import * as AgentActivityRows from "../agentActivity/AgentActivityRows.ts";
import * as ApnsClient from "../agentActivity/ApnsClient.ts";
import * as ApnsDeliveries from "../agentActivity/ApnsDeliveries.ts";
import * as ApnsDeliveryQueue from "../agentActivity/ApnsDeliveryQueue.ts";
import * as ApnsProviderTokens from "../agentActivity/ApnsProviderTokens.ts";
import * as DeliveryAttempts from "../agentActivity/DeliveryAttempts.ts";
import * as Devices from "../agentActivity/Devices.ts";
import * as FcmAssertionSigner from "../agentActivity/FcmAssertionSigner.ts";
import * as FcmClient from "../agentActivity/FcmClient.ts";
import * as FcmDeliveries from "../agentActivity/FcmDeliveries.ts";
import * as FcmDeliveryQueueSender from "../agentActivity/FcmDeliveryQueueSender.ts";
import * as LiveActivities from "../agentActivity/LiveActivities.ts";
import * as MobileRegistrations from "../agentActivity/MobileRegistrations.ts";
import * as CloudMintSigner from "../auth/CloudMintSigner.ts";
import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as RelayConfiguration from "../Config.ts";
import * as RelayDb from "../db.ts";
import * as CloudflareApiPause from "../environments/CloudflareApiPause.ts";
import * as EnvironmentConnector from "../environments/EnvironmentConnector.ts";
import * as EnvironmentCredentials from "../environments/EnvironmentCredentials.ts";
import * as EnvironmentLinker from "../environments/EnvironmentLinker.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as EnvironmentPublishSignatures from "../environments/EnvironmentPublishSignatures.ts";
import * as ManagedEndpointAllocations from "../environments/ManagedEndpointAllocations.ts";
import * as ManagedEndpointProvider from "../environments/ManagedEndpointProvider.ts";
import * as ManagedTunnelLimits from "../environments/ManagedTunnelLimits.ts";
import * as HeldHooks from "../hooks/HeldHooks.ts";
import * as HookForwarder from "../hooks/HookForwarder.ts";
import * as HookInbox from "../hooks/HookInbox.ts";
import * as RelayHttpApi from "../http/Api.ts";
import { RELAY_HTTP_ROUTER_CONFIG, traceRelayHttpRequestWith } from "../http/Api.ts";
import * as MobileTelemetry from "../mobileTelemetry/MobileTelemetry.ts";
import * as T3ChatAccounts from "../t3chat/T3ChatAccounts.ts";
import * as WebCrypto from "../WebCrypto.ts";
import * as DeliveryWorker from "./DeliveryWorker.ts";

export interface NodeRelayOptions {
  readonly configuration: RelayConfiguration.RelayConfiguration["Service"];
  readonly databaseUrl: Redacted.Redacted<string>;
  readonly migrationsFolder: string;
  /** Protocol and host clients sign into their DPoP proofs, whatever proxy sits in front. */
  readonly publicOrigin: URL;
  readonly apnsBaseUrl: string | undefined;
}

const MAINTENANCE_INTERVAL = "5 minutes";
// Node reads a body of any size unless told otherwise, and the largest real request is a few kilobytes.
const MAX_REQUEST_BODY = ByteSize.mebibytes(1);

const layerCrypto = Layer.mergeAll(
  Digest.layerWebCrypto,
  Mac.layerWebCrypto,
  Signature.layerWebCrypto,
).pipe(Layer.provideMerge(SecureRandom.layerWebCrypto));

const layerDatabase = (options: NodeRelayOptions) =>
  Layer.effect(
    RelayDb.RelayDb,
    Effect.gen(function* () {
      const db = yield* PgDrizzle.makeWithDefaults();
      yield* migrate(db, {
        migrationsFolder: options.migrationsFolder,
        migrationsTable: "relay_migrations",
        migrationsSchema: "public",
      });
      return db;
    }),
  ).pipe(Layer.provide(PgClient.layer({ url: options.databaseUrl })));

// Stage 1 has no tunnels: a link that asks for one is refused, and there is never one to remove.
const layerManagedEndpointsOff = Layer.succeed(ManagedEndpointProvider.ManagedEndpointProvider, {
  provision: Effect.fn("ManagedEndpointProvider.provision")(function* ({ userId, environmentId }) {
    return yield* new ManagedEndpointProvider.ManagedEndpointProvisioningNotConfigured({
      userId,
      environmentId,
      missingSettings: ["managedEndpointBaseDomain", "managedEndpointNamespace"],
    });
  }),
  reconcileOrigin: Effect.fn("ManagedEndpointProvider.reconcileOrigin")(function () {
    return Effect.succeed("recovery_required" as const);
  }),
  prepareDeprovision: Effect.fn("ManagedEndpointProvider.prepareDeprovision")(function () {
    return Effect.succeed(null);
  }),
  deprovision: Effect.fn("ManagedEndpointProvider.deprovision")(function () {
    return Effect.succeed(true);
  }),
  release: Effect.fn("ManagedEndpointProvider.release")(function () {
    return Effect.succeed(false);
  }),
});

// Webhooks arrive through tunnels, so nothing is ever held.
const layerHookInboxOff = Layer.succeed(HookInbox.HookInbox, {
  hold: Effect.fn("HookInbox.hold")(function () {
    return Effect.succeed(false);
  }),
  wake: Effect.fn("HookInbox.wake")(function () {
    return Effect.succeed(false);
  }),
  clear: Effect.fn("HookInbox.clear")(function () {
    return Effect.void;
  }),
});

const layerHooksOff = HookForwarder.layerApi.pipe(
  Layer.provide(
    Layer.succeed(HookForwarder.HookForwarder, {
      handle: Effect.fn("HookForwarder.handle")(function () {
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: "hook_not_found" }, { status: 404 }),
        );
      }),
    }),
  ),
);

// The mobile app's crash reporter posts here once it is built against this relay; accept and drop.
const layerMobileTelemetryOff = MobileTelemetry.layerApi.pipe(
  Layer.provide(
    Layer.succeed(MobileTelemetry.MobileTelemetry, {
      handle: Effect.fn("MobileTelemetry.handle")(function () {
        return Effect.succeed(HttpServerResponse.empty({ status: 202 }));
      }),
    }),
  ),
);

const layerFcmOff = Layer.succeed(FcmDeliveryQueueSender.FcmDeliveryQueueSender, {
  send: Effect.fn("FcmDeliveryQueueSender.send")(function () {
    return Effect.void;
  }),
});

const layerPersistence = (options: NodeRelayOptions) =>
  Layer.mergeAll(LiveActivities.layer, T3ChatAccounts.layer).pipe(
    Layer.provideMerge(DeliveryAttempts.layer),
    Layer.provideMerge(RelayTokens.layer.pipe(Layer.provideMerge(CloudMintSigner.layer))),
    Layer.provideMerge(
      RelayDb.RelayTransactions.layer.pipe(Layer.provideMerge(layerDatabase(options))),
    ),
    Layer.provideMerge(Layer.succeed(RelayConfiguration.RelayConfiguration, options.configuration)),
    Layer.provideMerge(layerCrypto),
    // APNs only speaks HTTP/2, which undici negotiates when asked to.
    Layer.provideMerge(NodeHttpClient.layerUndiciOptions({ allowH2: true })),
  );

const layerRuntime = (options: NodeRelayOptions) =>
  Layer.empty.pipe(
    Layer.provideMerge(MobileRegistrations.layer),
    Layer.provideMerge(AgentActivityPublisher.layer),
    Layer.provideMerge(EnvironmentConnector.layer),
    Layer.provideMerge(EnvironmentLinker.layer),
    Layer.provideMerge(Layer.mergeAll(EnvironmentPublishSignatures.layer, HeldHooks.layer)),
    Layer.provideMerge(layerManagedEndpointsOff),
    Layer.provideMerge(DpopProofs.layer),
    Layer.provideMerge(DeliveryWorker.layer),
    Layer.provideMerge(ApnsDeliveries.layer),
    Layer.provideMerge(
      FcmDeliveries.layer.pipe(
        Layer.provide(layerFcmOff),
        Layer.provideMerge(
          FcmClient.layer.pipe(
            Layer.provide(FcmAssertionSigner.layer),
            Layer.provide(Layer.succeed(WebCrypto.WebCrypto, { subtle: globalThis.crypto.subtle })),
          ),
        ),
      ),
    ),
    Layer.provideMerge(
      ApnsClient.layer.pipe(
        Layer.provideMerge(ApnsProviderTokens.layer),
        Layer.provide(Layer.succeed(ApnsClient.ApnsBaseUrl, options.apnsBaseUrl)),
      ),
    ),
    Layer.provideMerge(ApnsDeliveryQueue.layer.pipe(Layer.provide(DeliveryWorker.layerSender))),
    Layer.provideMerge(
      Layer.mergeAll(
        AgentActivityRows.layer,
        Devices.layer,
        layerHookInboxOff,
        DeliveryWorker.ApnsDeliveryBacklog.layer,
      ),
    ),
    Layer.provideMerge(EnvironmentCredentials.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        CloudflareApiPause.layer,
        EnvironmentLinks.layer,
        ManagedEndpointAllocations.layer,
        ManagedTunnelLimits.layer,
      ),
    ),
    Layer.provideMerge(layerPersistence(options)),
  );

// The Worker's cron without its tunnel reaper.
const maintenance = Effect.all(
  [
    DpopProofs.DpopProofReplay.pipe(
      Effect.flatMap((dpopProofs) => dpopProofs.pruneExpired),
      Effect.andThen(
        Effect.all([AgentActivityRows.AgentActivityRows, DateTime.now]).pipe(
          Effect.flatMap(([activityRows, now]) =>
            activityRows.pruneTerminal({
              updatedBefore: DateTime.formatIso(DateTime.subtract(now, { minutes: 30 })),
            }),
          ),
        ),
      ),
      Effect.andThen(
        DeliveryAttempts.DeliveryAttempts.pipe(Effect.flatMap((attempts) => attempts.pruneExpired)),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.logWarning("Failed to prune expired relay state", { cause }),
      ),
    ),
    AgentActivityPublisher.AgentActivityPublisher.pipe(
      Effect.flatMap((publisher) => publisher.endIdleLiveActivities),
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.logWarning("Failed to end idle Live Activities", { cause }),
      ),
    ),
  ],
  { concurrency: 2, discard: true },
).pipe(Effect.withSpan("relay.maintenance.prune_expired_state"));

// Behind a TLS proxy the socket says `http://<internal host>`, and a proof signed for the public URL would never match.
const pinPublicOrigin =
  (publicOrigin: URL) =>
  <E, R>(
    httpEffect: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E,
      HttpServerRequest.HttpServerRequest | R
    >,
  ) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Effect.provideService(
        httpEffect,
        HttpServerRequest.HttpServerRequest,
        request.modify({
          protocol: publicOrigin.protocol === "https:" ? "https" : "http",
          headers: Headers.set(request.headers, "host", publicOrigin.host),
        }),
      ),
    );

/** Builds every service once, starts the delivery worker and maintenance timer, and returns the request handler. */
export const makeHttpEffect = Effect.fn("relay.node.makeHttpEffect")(function* (
  options: NodeRelayOptions,
) {
  const runtime = yield* Layer.build(layerRuntime(options));
  yield* maintenance.pipe(
    Effect.repeat(Schedule.spaced(MAINTENANCE_INTERVAL)),
    Effect.provideContext(runtime),
    Effect.forkScoped,
  );
  const layerApp = Layer.mergeAll(
    RelayHttpApi.layerHealthApi,
    RelayHttpApi.layerMetadataApi,
    RelayHttpApi.layerMobileApi,
    RelayHttpApi.layerClientApi,
    RelayHttpApi.layerTokenApi,
    RelayHttpApi.layerDpopClientApi,
    RelayHttpApi.layerServerApi,
    layerHooksOff,
    layerMobileTelemetryOff,
  ).pipe(
    Layer.provideMerge(RelayHttpApi.layerClientAuth),
    Layer.provideMerge(RelayHttpApi.layerDpopClientAuth),
    Layer.provideMerge(RelayHttpApi.layerEnvironmentAuth),
    Layer.provide(Layer.succeedContext(runtime)),
  );
  const httpEffect = yield* Layer.merge(
    Layer.mergeAll(
      // No API docs page or OpenAPI file: this relay serves one owner's devices, not integrators.
      HttpApiBuilder.layer(RelayApi).pipe(Layer.provide(layerApp)),
    ).pipe(
      Layer.provide([
        NodeServices.layer,
        NodeHttpPlatform.layer,
        Etag.layerWeak,
        RelayHttpApi.layerCors,
      ]),
    ),
    RelayHttpApi.layerNotFoundRoute,
  ).pipe(
    HttpRouter.toHttpEffect,
    Effect.provideService(HttpRouter.RouterConfig, RELAY_HTTP_ROUTER_CONFIG),
  );
  // Handlers also read services while a request runs, not only when the routes are built.
  return pinPublicOrigin(options.publicOrigin)(
    traceRelayHttpRequestWith(
      httpEffect.pipe(
        Effect.provideContext(runtime),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, MAX_REQUEST_BODY),
      ),
      Layer.empty,
    ),
  );
});
