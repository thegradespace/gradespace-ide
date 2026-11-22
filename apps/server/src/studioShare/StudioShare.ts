import {
  STUDIO_SHARE_DEFAULT_BASE_URL,
  STUDIO_SHARE_FILE_PATTERN,
  STUDIO_SHARE_MAX_BYTES,
  StudioShareError,
  type StudioShareComment,
  type StudioShareComments,
  type StudioShareCreateInput,
  type StudioShareEntry,
  type StudioShareList,
  type StudioShareStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
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
const COMMENTS_CONCURRENCY = 4;

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
  // Sent by websites that take comments; older ones leave them out.
  commentsEnabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  commentCount: Schema.optional(Schema.NullOr(Schema.Number)),
  sourcePath: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeShare = Schema.decodeUnknownEffect(RemoteShare);
const decodeShares = Schema.decodeUnknownEffect(
  Schema.Struct({ shares: Schema.Array(RemoteShare) }),
);

const finiteAtLeastZero = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const RemoteComment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  comment: Schema.String,
  fx: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  fy: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  page: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        x: finiteAtLeastZero,
        y: finiteAtLeastZero,
        width: finiteAtLeastZero,
        height: finiteAtLeastZero,
        selector: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
      }),
    ),
  ),
  createdAt: Schema.String,
});
const decodeComments = Schema.decodeUnknownEffect(
  Schema.Struct({ comments: Schema.Array(RemoteComment) }),
);

/** A share that still takes comments from viewers of a file in `setPath`. */
function isWatchedShare(
  share: typeof RemoteShare.Type,
  setPath: string,
  now: number,
): share is typeof RemoteShare.Type & { sourcePath: string } {
  if (share.revoked === true || share.commentsEnabled !== true) return false;
  if (typeof share.sourcePath !== "string") return false;
  if (share.expiresAt != null && Date.parse(share.expiresAt) <= now) return false;
  const prefix = `${setPath.replace(/\/+$/, "")}/`;
  return share.sourcePath.startsWith(prefix);
}

const oneLine = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

function toStudioComment(
  share: { readonly id: string; readonly sourcePath: string },
  comment: typeof RemoteComment.Type,
): StudioShareComment | null {
  const id = comment.id.trim();
  const name = oneLine(comment.name, 40);
  const text = comment.comment.trim().slice(0, 1000);
  if (id.length === 0 || name.length === 0 || text.length === 0) return null;
  const page = comment.page;
  return {
    id,
    shareId: share.id,
    relativePath: share.sourcePath,
    name,
    comment: text,
    fx: comment.fx,
    fy: comment.fy,
    page:
      page == null || page.width <= 0 || page.height <= 0
        ? null
        : {
            x: page.x,
            y: page.y,
            width: page.width,
            height: page.height,
            selector: oneLine(page.selector ?? "", 200),
            text: oneLine(page.text ?? "", 80),
          },
    createdAt: comment.createdAt,
  };
}

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
    /** Comments viewers left on live links shared from the set, oldest first. */
    readonly comments: (setPath: string) => Effect.Effect<StudioShareComments, StudioShareError>;
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
    ...(share.commentsEnabled === true ? { commentsEnabled: true } : {}),
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
      // Websites without comments ignore both fields, so the link still works there.
      if (input.allowComments === true) form.append("allowComments", "true");
      form.append("sourcePath", input.relativePath.replace(/^\.\/+/, ""));

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

  const listRemote = Effect.fn("StudioShare.listRemote")(function* (
    baseUrl: string,
    token: string,
  ) {
    const response = yield* send(
      HttpClientRequest.get(`${baseUrl}/api/studio-shares`).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.acceptJson,
      ),
    );
    if (response.status !== 200) return yield* rejectStatus(response);
    return yield* response.json.pipe(Effect.flatMap(decodeShares), Effect.mapError(failed));
  });

  const list: StudioShare["Service"]["list"] = Effect.gen(function* () {
    const { baseUrl, token } = yield* connection;
    const body = yield* listRemote(baseUrl, token);
    return { shares: body.shares.map((share) => toEntry(baseUrl, share)) };
  }).pipe(Effect.withSpan("StudioShare.list"));

  const shareComments = Effect.fn("StudioShare.shareComments")(function* (
    baseUrl: string,
    token: string,
    share: { readonly id: string; readonly sourcePath: string },
  ) {
    const response = yield* send(
      HttpClientRequest.get(
        `${baseUrl}/api/studio-shares/${encodeURIComponent(share.id)}/comments`,
      ).pipe(HttpClientRequest.bearerToken(token), HttpClientRequest.acceptJson),
    );
    // Gone since the list was read, or a website without comments.
    if (response.status === 404) return [];
    if (response.status !== 200) return yield* rejectStatus(response);
    const body = yield* response.json.pipe(Effect.flatMap(decodeComments), Effect.mapError(failed));
    return body.comments.flatMap((comment) => {
      const studioComment = toStudioComment(share, comment);
      return studioComment === null ? [] : [studioComment];
    });
  });

  const comments: StudioShare["Service"]["comments"] = Effect.fn("StudioShare.comments")(
    function* (setPath) {
      const { baseUrl, offline } = yield* resolveBaseUrl;
      const token = yield* readToken;
      // Polled in the background: no key or offline simply means nothing to show.
      if (offline || Option.isNone(token)) return { comments: [], watching: 0 };
      const body = yield* listRemote(baseUrl, token.value);
      const now = yield* Clock.currentTimeMillis;
      const watched = body.shares.filter((share) => isWatchedShare(share, setPath, now));
      const withComments = watched.filter((share) => (share.commentCount ?? 1) > 0);
      const lists = yield* Effect.forEach(
        withComments,
        (share) => shareComments(baseUrl, token.value, share),
        { concurrency: COMMENTS_CONCURRENCY },
      );
      const all = lists
        .flat()
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return { comments: all, watching: watched.length };
    },
  );

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

  return StudioShare.of({ status, setToken, create, list, revoke, comments });
});

export const layer = Layer.effect(StudioShare, make);
