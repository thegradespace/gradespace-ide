import {
  STUDIO_SHARE_DEFAULT_BASE_URL,
  STUDIO_SHARE_FILE_PATTERN,
  STUDIO_SHARE_MAX_BYTES,
  StudioShareError,
  type StudioShareCreateInput,
  type StudioShareEntry,
  type StudioShareList,
  type StudioShareStatus,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";

const TOKEN_SECRET_NAME = "studio-share-token";
const REQUEST_TIMEOUT = "30 seconds";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html",
  htm: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  md: "text/markdown",
};

const RemoteShare = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  fileName: Schema.String,
  contentType: Schema.String,
  sizeBytes: Schema.Number,
  createdAt: Schema.String,
  expiresAt: Schema.optional(Schema.NullOr(Schema.String)),
  revoked: Schema.optional(Schema.Boolean),
});
const decodeShare = Schema.decodeUnknownEffect(RemoteShare);
const decodeShares = Schema.decodeUnknownEffect(
  Schema.Struct({ shares: Schema.Array(RemoteShare) }),
);

const baseUrlFromEnv = Config.String("GS_STUDIO_SHARE_BASE_URL").pipe(Config.withDefault(""));

export class StudioShare extends Context.Service<
  StudioShare,
  {
    readonly status: Effect.Effect<StudioShareStatus, StudioShareError>;
    /** A null token removes the saved key. */
    readonly setToken: (token: string | null) => Effect.Effect<StudioShareStatus, StudioShareError>;
    /** Uploads a file from inside a known project and returns its public link. */
    readonly create: (
      input: StudioShareCreateInput,
    ) => Effect.Effect<StudioShareEntry, StudioShareError>;
    readonly list: Effect.Effect<StudioShareList, StudioShareError>;
    readonly revoke: (id: string) => Effect.Effect<StudioShareList, StudioShareError>;
  }
>()("t3/studioShare/StudioShare") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const path = yield* Path.Path;

  const failed = (cause: unknown) => new StudioShareError({ reason: "failed", cause });

  const readToken = secrets
    .get(TOKEN_SECRET_NAME)
    .pipe(
      Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())),
      Effect.map(Option.filter((token) => token.length > 0)),
      Effect.mapError(failed),
    );

  const resolveBaseUrl = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(Effect.mapError(failed));
    const fromEnv = yield* baseUrlFromEnv.pipe(Effect.mapError(failed));
    const raw = settings.studioShareBaseUrl || fromEnv || STUDIO_SHARE_DEFAULT_BASE_URL;
    const url = yield* Effect.try({
      try: () => new URL(raw),
      catch: failed,
    });
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return yield* failed(new Error("Unsupported share address."));
    }
    return {
      baseUrl: url.origin + url.pathname.replace(/\/+$/, ""),
      offline: settings.offlineMode,
    };
  });

  const status: StudioShare["Service"]["status"] = Effect.gen(function* () {
    const { baseUrl } = yield* resolveBaseUrl;
    return { configured: Option.isSome(yield* readToken), baseUrl };
  }).pipe(Effect.withSpan("StudioShare.status"));

  const setToken: StudioShare["Service"]["setToken"] = Effect.fn("StudioShare.setToken")(
    function* (token) {
      yield* (
        token === null
          ? secrets.remove(TOKEN_SECRET_NAME)
          : secrets.set(TOKEN_SECRET_NAME, new TextEncoder().encode(token.trim()))
      ).pipe(Effect.mapError(failed));
      return yield* status;
    },
  );

  /** Everything every call needs before touching the network. */
  const connection = Effect.gen(function* () {
    const { baseUrl, offline } = yield* resolveBaseUrl;
    if (offline) return yield* new StudioShareError({ reason: "offline" });
    const token = yield* readToken;
    if (Option.isNone(token)) return yield* new StudioShareError({ reason: "notConfigured" });
    return { baseUrl, token: token.value };
  });

  const send = (request: HttpClientRequest.HttpClientRequest) =>
    httpClient.execute(request).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError((cause) => new StudioShareError({ reason: "unreachable", cause })),
    );

  const rejectStatus = (response: HttpClientResponse.HttpClientResponse) => {
    switch (response.status) {
      case 401:
        return new StudioShareError({ reason: "keyRejected" });
      case 413:
        return new StudioShareError({ reason: "tooLarge" });
      case 503:
        return new StudioShareError({ reason: "notSetUpOnSite" });
      default:
        return new StudioShareError({
          reason: "failed",
          cause: new Error(`The share service answered ${response.status}.`),
        });
    }
  };

  const toEntry = (baseUrl: string, share: typeof RemoteShare.Type): StudioShareEntry => ({
    id: share.id,
    url: new URL(share.url, `${baseUrl}/`).toString(),
    title: share.title ?? "",
    fileName: share.fileName,
    contentType: share.contentType,
    sizeBytes: share.sizeBytes,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt ?? null,
    revoked: share.revoked ?? false,
  });

  const create: StudioShare["Service"]["create"] = Effect.fn("StudioShare.create")(
    function* (input) {
      const { baseUrl, token } = yield* connection;
      const extension = path.extname(input.relativePath).slice(1).toLowerCase();
      if (!STUDIO_SHARE_FILE_PATTERN.test(input.relativePath)) {
        return yield* new StudioShareError({ reason: "unsupportedType" });
      }
      const file = yield* workspaceFileSystem
        .readBytes({
          cwd: input.cwd,
          relativePath: input.relativePath,
          maxBytes: STUDIO_SHARE_MAX_BYTES,
        })
        .pipe(
          Effect.catchTags({
            WorkspacePathOutsideRootError: () =>
              Effect.fail(new StudioShareError({ reason: "outsideProject" })),
            WorkspaceFilePathEscapeError: () =>
              Effect.fail(new StudioShareError({ reason: "outsideProject" })),
            UnknownWorkspaceError: () =>
              Effect.fail(new StudioShareError({ reason: "outsideProject" })),
            WorkspaceFileSystemOperationError: (cause) =>
              Effect.fail(new StudioShareError({ reason: "fileUnreadable", cause })),
            WorkspacePathNotFileError: (cause) =>
              Effect.fail(new StudioShareError({ reason: "fileUnreadable", cause })),
            WorkspaceBinaryFileError: (cause) =>
              Effect.fail(new StudioShareError({ reason: "fileUnreadable", cause })),
          }),
        );
      if (file.bytes === null) return yield* new StudioShareError({ reason: "tooLarge" });

      const fileName = path.basename(input.relativePath);
      const form = new FormData();
      form.append(
        "file",
        new Blob([file.bytes], { type: CONTENT_TYPES[extension] ?? "application/octet-stream" }),
        fileName,
      );
      const title = input.title?.trim() ?? "";
      if (title.length > 0) form.append("title", title);
      form.append("expiresInDays", String(input.expiresInDays));

      const response = yield* send(
        HttpClientRequest.post(`${baseUrl}/api/studio-shares`).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyFormData(form),
        ),
      );
      if (response.status !== 201 && response.status !== 200) return yield* rejectStatus(response);
      const share = yield* response.json.pipe(Effect.flatMap(decodeShare), Effect.mapError(failed));
      return toEntry(baseUrl, share);
    },
  );

  const list: StudioShare["Service"]["list"] = Effect.gen(function* () {
    const { baseUrl, token } = yield* connection;
    const response = yield* send(
      HttpClientRequest.get(`${baseUrl}/api/studio-shares`).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.acceptJson,
      ),
    );
    if (response.status !== 200) return yield* rejectStatus(response);
    const body = yield* response.json.pipe(Effect.flatMap(decodeShares), Effect.mapError(failed));
    return { shares: body.shares.map((share) => toEntry(baseUrl, share)) };
  }).pipe(Effect.withSpan("StudioShare.list"));

  const revoke: StudioShare["Service"]["revoke"] = Effect.fn("StudioShare.revoke")(function* (id) {
    const { baseUrl, token } = yield* connection;
    const response = yield* send(
      HttpClientRequest.make("DELETE")(
        `${baseUrl}/api/studio-shares/${encodeURIComponent(id)}`,
      ).pipe(HttpClientRequest.bearerToken(token)),
    );
    // A link that is already gone is what the caller wanted.
    if (response.status !== 204 && response.status !== 404) return yield* rejectStatus(response);
    return yield* list;
  });

  return StudioShare.of({ status, setToken, create, list, revoke });
});

export const layer = Layer.effect(StudioShare, make);
