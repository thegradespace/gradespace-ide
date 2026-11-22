# T3 Connect Relay

> [!NOTE]
> Sign in to T3 Connect from the app under Settings > Sharing & access.

The relay is the hosted control plane for T3 Connect. It helps clients discover and connect to
remote environments, manages the cloud-side records needed for those connections, and delivers
optional mobile notifications and Live Activities.

The relay is intentionally not in the hot path for normal T3 Code traffic. After a client connects,
regular API and WebSocket traffic goes directly between that client and the selected environment.
See the [T3 Connect architecture note](../../docs/internals/t3-connect.md) for the larger system
design.

## Responsibilities

The relay currently owns:

- Linking T3 Code environments to a cloud account.
- Provisioning and tracking managed environment endpoints.
- Issuing short-lived credentials used to connect clients to linked environments.
- Listing linked environments and registered mobile devices for an account.
- Registering mobile notification preferences and APNs or FCM tokens.
- Receiving published agent activity and delivering notifications or Live Activity updates.
- Persisting relay state and exposing relay-specific traces for diagnostics.

The environment server and relay have separate credentials and trust boundaries. Read
[Environment Authentication Profile](../../docs/internals/environment-auth.md) before changing token,
credential, or authorization behavior.

## Code Map

- [`alchemy.run.ts`](./alchemy.run.ts) defines the deployed Alchemy stack.
- [`src/worker.ts`](./src/worker.ts) wires Cloudflare bindings, runtime layers, queues, and HTTP APIs.
- [`src/node`](./src/node) is the self-hosted Node entry point: the same APIs on Postgres, with an
  in-process push queue and no Cloudflare.
- [`src/http/Api.ts`](./src/http/Api.ts) contains the relay HTTP handlers and authentication
  boundaries.
- [`src/environments`](./src/environments) contains environment linking, credentials, endpoint
  provisioning, and connection flows.
- [`src/agentActivity`](./src/agentActivity) contains mobile device registration, activity state,
  APNs and FCM delivery, and queue processing.
- [`src/auth`](./src/auth) contains relay token and DPoP proof handling.
- [`src/persistence/schema.ts`](./src/persistence/schema.ts) defines persisted relay state. Keep
  schema and migration changes together.

Shared request and response schemas live in
[`packages/contracts/src/relay.ts`](../../packages/contracts/src/relay.ts). Shared client-side relay
calls live in
[`packages/client-runtime/src/relay/managedRelay.ts`](../../packages/client-runtime/src/relay/managedRelay.ts).

## Working Locally

Install dependencies from the repository root, then run relay-focused checks from this directory:

```sh
vp install
cd infra/relay
vp test run
vp run typecheck
```

To run a smaller test set while iterating:

```sh
vp test run src/environments/EnvironmentLinker.test.ts
```

Before considering a change complete, run the repository-wide checks from the root:

```sh
vp check
vp run typecheck
```

Backend changes should include tests. Prefer testing the real business logic with external
dependencies represented at their boundary rather than mocking internal behavior.

## Run the Node relay with Docker

[`src/node/main.ts`](./src/node/main.ts) runs the relay as one Node process beside Postgres, for one
owner's own devices. It links environments, registers phones, and sends Apple push alerts and Live
Activity updates. It does not provision tunnels, forward webhooks, send Android (FCM) pushes, or
keep mobile telemetry: those routes answer but do nothing.

Sign-in is owner mode: one `RELAY_OWNER_TOKEN` is sent wherever the hosted relay expects a Clerk
token, and everything is stored under `RELAY_OWNER_USER_ID`. Anyone holding the token is the owner.
Replacing it is the only way to revoke it, and changing the user id orphans existing links and
devices.

```sh
cd infra/relay
cp .env.node.example .env.node   # explains every value and how to generate each secret
docker compose --env-file .env.node up --detach --build
curl http://127.0.0.1:8787/health   # {"ok":true,"service":"relay"}
```

The image is built from the repository root and is large (about 2 GB), because the relay imports
workspace packages whose dependencies come along. Database migrations apply on every start.

Both published ports bind to `127.0.0.1`. Put a TLS proxy or tunnel in front of port 8787 and set
`RELAY_PUBLIC_ORIGIN` to the address clients use. Clients sign that origin into every request proof,
so a wrong value makes token exchange and device registration fail with 401 while `/health` still
answers.

Pushes wait in memory and each failed job is retried five times, 30 seconds apart. A restart drops
the waiting jobs, which are at most ten minutes old, and the next published update repairs the Live
Activity.

To check a build end to end without an Apple key, run the smoke test. It starts the Compose stack
with throwaway keys and a local stand-in for Apple's push server, plays a server and a phone, checks
that an alert and a Live Activity push arrive, and removes the stack:

```sh
node scripts/owner-mode-smoke.ts
```

The smoke test plays the server itself. To check the real server against the relay, run the
end-to-end test instead. It builds the server CLI, links it with `gs connect link --publish-only`
through a local TLS proxy, runs free replayed agent turns through `gs serve`, and checks that their
alert and Live Activity pushes arrive:

```sh
node scripts/owner-mode-e2e.ts
```

Delivery to real devices through Apple has not been exercised by either test.

## Deployment

The relay deploys with the Alchemy CLI (`vp run --filter t3code-relay deploy` is `alchemy deploy`
in this directory):

```sh
vp run --filter t3code-relay deploy
```

The stack provisions the Cloudflare Worker and queues, managed endpoint resources, database
connectivity, and relay tracing resources. Copy [`infra/relay/.env.example`](./.env.example) to
`infra/relay/.env` and fill in the deployment-specific values before deploying. Alchemy loads that
file from the relay directory. Runtime secrets include Clerk, APNs, and optional FCM credentials. Set
`APNS_ENABLED=false` for an Android-only development deployment without Apple credentials. Production adopts
the configured API and tunnel DNS zones as retained Cloudflare resources. Personal stages reference
the production-owned zones.

The `prod` Alchemy stage owns the retained PlanetScale database and is the shared hosted relay for
stable and nightly clients. Every other stage references that database and provisions an isolated
PlanetScale branch and runtime role for local development, so deploy `prod` before creating
developer stages:

```sh
vp run --filter t3code-relay deploy -- --stage prod
vp run --filter t3code-relay deploy -- --env-file .env.local
```

Alchemy defaults personal deployments to the `dev_$USER` stage. Relay custom domains apply the same
DNS-safe sanitization as Alchemy physical resource names, so `prod` uses
`relay.<RELAY_API_ZONE_NAME>` and `dev_julius` uses
`relay-dev-julius.<RELAY_API_ZONE_NAME>`. Managed environment endpoints are provisioned below
`RELAY_TUNNEL_ZONE_NAME`, which may be a different Cloudflare zone. Production tunnel hostnames use
`prod-<digest>.<RELAY_TUNNEL_ZONE_NAME>`; personal stages use
`<stage>-<digest>.<RELAY_TUNNEL_ZONE_NAME>`. `RELAY_DOMAIN` remains available as an explicit API
domain override.

The stack's `PublishClientConfig` action ([`src/clientConfig.ts`](./src/clientConfig.ts)) writes the
deployed relay URL and tracing configuration into the repository-root `.env`, so subsequent source
builds point at the relay that was just deployed without copying values manually. It runs only when
one of those outputs changed, and `T3CODE_RELAY_CLIENT_CONFIG_ENV` redirects it to another file.

### Deployment CI

The relay is versioned separately from client releases. `.github/workflows/deploy-relay.yml` deploys
the shared Alchemy `prod` stage on every push to `main`. Stable and nightly release builds both
resolve their static public config from the same
`production` GitHub environment. Labeling a same-repository PR `relay:preview` deploys a `pr-<number>`
stage, and the cleanup workflow tears it down; see
[`relay-preview.yml`](../../.github/workflows/relay-preview.yml). Developers can
deploy personal non-production stages locally with any stage name other than `prod`.

The repository must define these Actions variables shared by relay deployments:

- `CLOUDFLARE_ACCOUNT_ID`
- `PLANETSCALE_ORGANIZATION`
- `AXIOM_ORG_ID`

The repository must define these Actions secrets shared by relay deployments:

- `CLOUDFLARE_API_TOKEN`
- `PLANETSCALE_API_TOKEN_ID`
- `PLANETSCALE_API_TOKEN`
- `AXIOM_TOKEN`

The `production` GitHub environment must define these Actions variables:

- `RELAY_API_ZONE_NAME`
- `RELAY_TUNNEL_ZONE_NAME`
- `RELAY_DOMAIN` if overriding the derived production relay domain
- `RELAY_ALERT_NOTIFIER_ID`, the Axiom notifier that relay alerts page. Without it the deployment
  creates no monitors or health dashboard. See
  [Relay alerts](../../docs/operations/relay-observability.md#alerts).
- `RELAY_WARNING_NOTIFIER_ID`, optional, the Axiom notifier for relay warnings
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_JWT_AUDIENCE`
- `CLERK_JWT_TEMPLATE`
- `APNS_ENVIRONMENT`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_BUNDLE_ID`

The `production` GitHub environment must define these Actions secrets:

- `CLERK_SECRET_KEY`
- `APNS_PRIVATE_KEY`
- `FCM_SERVICE_ACCOUNT` when Android push is enabled
- `T3CHAT_LINK_SECRET`, optional, shared with T3 Chat's `T3CODE_LINK_SECRET`. Without it the
  T3 Chat account link is off. Local and preview stages can set `T3CHAT_URL` to point
  at another T3 Chat deployment; production uses `https://t3.chat`.

The account-scoped repository credentials are consumed by Alchemy while provisioning relay stages; they
are not bound into the relay Worker. The production deployment uses an Axiom personal access token,
so `AXIOM_ORG_ID` must accompany `AXIOM_TOKEN`. The release workflow reads the production relay's
derived public URL and Clerk publishable key from the same environment for downstream desktop, CLI,
and hosted web builds.

See:

- [T3 Connect setup](../../docs/operations/connect-setup.md) for Clerk keys, JWT templates, and sign-up restrictions.
- [Relay Observability](../../docs/operations/relay-observability.md) for deployment tracing and diagnostics.
- [T3 Connect architecture](../../docs/internals/t3-connect.md) for environment linking and trust boundaries.
