import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { STUDIO_SHARE_MAX_BYTES, StudioShareError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as StudioShare from "./StudioShare.ts";

const KEY = "gs-test-share-key";

const shareJson = (overrides: Record<string, unknown> = {}) => ({
  id: "abc123",
  url: "https://thegradespace.com/s/abc123",
  title: "A: Bold",
  fileName: "a.html",
  contentType: "text/html",
  sizeBytes: 12,
  createdAt: "2026-11-05T10:00:00.000Z",
  expiresAt: "2026-11-12T10:00:00.000Z",
  ...overrides,
});

type Handler = (request: HttpClientRequest.HttpClientRequest) => Response | "unreachable";

const layerFor = (
  requests: HttpClientRequest.HttpClientRequest[],
  handler: Handler,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) => {
  const layerHttpClient = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request);
      const result = handler(request);
      return result === "unreachable"
        ? Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request }),
            }),
          )
        : Effect.succeed(HttpClientResponse.fromWeb(request, result));
    }),
  );
  const layerFiles = WorkspaceFileSystem.layer.pipe(
    Layer.provide(
      Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
    ),
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  );
  return StudioShare.layer.pipe(
    Layer.provideMerge(layerFiles),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(ServerSettings.layerTest(settings)),
    Layer.provideMerge(layerHttpClient),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-studio-share-test-" })),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
};

const created = () => new Response(JSON.stringify(shareJson()), { status: 201 });

const makeProject = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-studio-share-project-" });
  yield* fileSystem.makeDirectory(path.join(cwd, "design"), { recursive: true });
  yield* fileSystem.writeFileString(path.join(cwd, "design/a.html"), "<h1>Hi</h1>");
  yield* fileSystem.writeFileString(path.join(cwd, "design/notes.ts"), "export {};");
  return cwd;
});

const input = (cwd: string, relativePath = "design/a.html") => ({
  cwd,
  relativePath,
  title: "A: Bold",
  expiresInDays: 7 as const,
});

const failure = <A, R>(effect: Effect.Effect<A, StudioShareError, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

it.effect("never reports the saved key to clients", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  return Effect.gen(function* () {
    const share = yield* StudioShare.StudioShare;
    expect(yield* share.status).toEqual({
      configured: false,
      baseUrl: "https://thegradespace.com",
    });
    const saved = yield* share.setToken(`  ${KEY}  `);
    expect(saved.configured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect((yield* share.setToken(null)).configured).toBe(false);
  }).pipe(Effect.provide(layerFor(requests, created)));
});

it.effect("uploads the file with the key and the form fields the website expects", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  return Effect.gen(function* () {
    const share = yield* StudioShare.StudioShare;
    const cwd = yield* makeProject;
    yield* share.setToken(KEY);

    const entry = yield* share.create(input(cwd));

    expect(entry).toMatchObject({ id: "abc123", title: "A: Bold", revoked: false });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("http://share.test/api/studio-shares");
    expect(request?.headers.authorization).toBe(`Bearer ${KEY}`);
    const body = request?.body;
    if (body?._tag !== "FormData") throw new Error("expected a multipart body");
    const file = body.formData.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("a.html");
    expect((file as File).type).toBe("text/html");
    expect(yield* Effect.promise(() => (file as File).text())).toBe("<h1>Hi</h1>");
    expect(body.formData.get("title")).toBe("A: Bold");
    expect(body.formData.get("expiresInDays")).toBe("7");
    // Comments stay off unless asked for; the path lets Studio match comments to the option.
    expect(body.formData.get("allowComments")).toBeNull();
    expect(body.formData.get("sourcePath")).toBe("design/a.html");

    yield* share.create({ ...input(cwd), allowComments: true });
    const second = requests[1]?.body;
    if (second?._tag !== "FormData") throw new Error("expected a multipart body");
    expect(second.formData.get("allowComments")).toBe("true");
  }).pipe(
    Effect.provide(layerFor(requests, created, { studioShareBaseUrl: "http://share.test/" })),
  );
});

it.effect("maps website and network failures to readable errors", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  let answer: Response | "unreachable" = created();
  return Effect.gen(function* () {
    const share = yield* StudioShare.StudioShare;
    const cwd = yield* makeProject;
    yield* share.setToken(KEY);
    const outcomes: Array<readonly [Response | "unreachable", string]> = [
      [new Response("", { status: 401 }), "keyRejected"],
      [new Response("", { status: 413 }), "tooLarge"],
      [new Response("", { status: 503 }), "notSetUpOnSite"],
      [new Response("", { status: 500 }), "failed"],
      ["unreachable", "unreachable"],
    ];
    for (const [response, reason] of outcomes) {
      answer = response;
      expect(yield* failure(share.create(input(cwd)))).toBe(reason);
    }
    expect(new StudioShareError({ reason: "notSetUpOnSite" }).message).toBe(
      "Sharing isn't set up on the website yet.",
    );
  }).pipe(Effect.provide(layerFor(requests, () => answer)));
});

it.effect("refuses before any upload", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  return Effect.gen(function* () {
    const share = yield* StudioShare.StudioShare;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* makeProject;
    yield* fileSystem.writeFileString(
      path.join(cwd, "big.pdf"),
      "x".repeat(STUDIO_SHARE_MAX_BYTES + 1),
    );
    const outside = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-studio-share-outside-",
    });
    yield* fileSystem.writeFileString(path.join(outside, "secret.html"), "secret");

    expect(yield* failure(share.create(input(cwd)))).toBe("notConfigured");
    yield* share.setToken(KEY);
    expect(yield* failure(share.create(input(cwd, "design/notes.ts")))).toBe("unsupportedType");
    expect(yield* failure(share.create(input(cwd, "big.pdf")))).toBe("tooLarge");
    expect(yield* failure(share.create(input(cwd, "../secret.html")))).toBe("outsideProject");
    expect(yield* failure(share.create(input(cwd, path.join(outside, "secret.html"))))).toBe(
      "outsideProject",
    );
    expect(requests).toHaveLength(0);
  }).pipe(Effect.provide(layerFor(requests, created)));
});

it.effect("stays off the network in offline mode", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  return Effect.gen(function* () {
    const share = yield* StudioShare.StudioShare;
    const cwd = yield* makeProject;
    yield* share.setToken(KEY);
    expect(yield* failure(share.create(input(cwd)))).toBe("offline");
    expect(yield* failure(share.list)).toBe("offline");
    expect(yield* failure(share.revoke("abc123"))).toBe("offline");
    // Studio polls comments in the background, so offline just means none.
    expect(yield* share.comments(".gradespace/studio/set")).toEqual({ comments: [], watching: 0 });
    expect(requests).toHaveLength(0);
  }).pipe(Effect.provide(layerFor(requests, created, { offlineMode: true })));
});

it.effect("lists shares and turns one off", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  let deleted = false;
  return Effect.gen(function* () {
    const share = yield* StudioShare.StudioShare;
    yield* share.setToken(KEY);
    expect((yield* share.list).shares[0]).toMatchObject({ id: "abc123", revoked: false });

    const afterRevoke = yield* share.revoke("abc123/../x");
    expect(afterRevoke.shares[0]?.revoked).toBe(true);
    const remove = requests.find((request) => request.method === "DELETE");
    expect(remove?.url).toBe("https://thegradespace.com/api/studio-shares/abc123%2F..%2Fx");
    expect(remove?.headers.authorization).toBe(`Bearer ${KEY}`);
  }).pipe(
    Effect.provide(
      layerFor(requests, (request) => {
        if (request.method === "DELETE") {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ shares: [shareJson({ revoked: deleted })] }));
      }),
    ),
  );
});

it.effect("fetches comments only for live links from the set that have some", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const set = ".gradespace/studio/2026-11-22-test";
  const comment = (id: string, createdAt: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: "Ada",
    comment: "Bigger logo",
    fx: 0.25,
    fy: 0.5,
    page: { x: 100, y: 800, width: 1280, height: 3000, selector: "h1", text: "Welcome" },
    createdAt,
    ...overrides,
  });
  return Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-22T12:00:00.000Z"));
    const share = yield* StudioShare.StudioShare;
    expect(yield* share.comments(set)).toEqual({ comments: [], watching: 0 });
    expect(requests).toHaveLength(0);
    yield* share.setToken(KEY);

    const result = yield* share.comments(`${set}/`);

    expect(result.watching).toBe(4);
    expect(result.comments.map((entry) => [entry.id, entry.shareId, entry.relativePath])).toEqual([
      ["c2", "b", `${set}/b.v1.html`],
      ["c1", "a", `${set}/a.html`],
    ]);
    expect(result.comments[0]?.page).toBeNull();
    expect(result.comments[1]).toMatchObject({
      name: "Ada",
      comment: "Bigger logo",
      page: { x: 100, y: 800, width: 1280, height: 3000, selector: "h1", text: "Welcome" },
    });
    const fetched = requests
      .map((request) => request.url)
      .filter((url) => url.endsWith("/comments"))
      .toSorted();
    expect(fetched).toEqual([
      "https://thegradespace.com/api/studio-shares/a/comments",
      "https://thegradespace.com/api/studio-shares/b/comments",
      "https://thegradespace.com/api/studio-shares/gone/comments",
    ]);
    expect(requests.every((request) => request.headers.authorization === `Bearer ${KEY}`)).toBe(
      true,
    );
  }).pipe(
    Effect.provide(
      layerFor(requests, (request) => {
        const live = { commentsEnabled: true, expiresAt: "2026-11-29T10:00:00.000Z" };
        if (request.url.endsWith("/api/studio-shares")) {
          return new Response(
            JSON.stringify({
              shares: [
                shareJson({ id: "a", ...live, commentCount: 1, sourcePath: `${set}/a.html` }),
                shareJson({ id: "b", ...live, commentCount: 2, sourcePath: `${set}/b.v1.html` }),
                shareJson({ id: "gone", ...live, commentCount: 1, sourcePath: `${set}/c.html` }),
                shareJson({ id: "quiet", ...live, commentCount: 0, sourcePath: `${set}/d.html` }),
                shareJson({ id: "off", commentCount: 3, sourcePath: `${set}/a.html` }),
                shareJson({
                  id: "old",
                  ...live,
                  commentCount: 3,
                  sourcePath: `${set}/a.html`,
                  expiresAt: "2026-11-21T10:00:00.000Z",
                }),
                shareJson({
                  id: "revoked",
                  ...live,
                  revoked: true,
                  commentCount: 3,
                  sourcePath: `${set}/a.html`,
                }),
                shareJson({
                  id: "other",
                  ...live,
                  commentCount: 3,
                  sourcePath: ".gradespace/studio/2026-11-22-test-2/a.html",
                }),
                shareJson({ id: "legacy" }),
              ],
            }),
          );
        }
        if (request.url.includes("/gone/")) return new Response("", { status: 404 });
        if (request.url.includes("/a/")) {
          return new Response(
            JSON.stringify({ comments: [comment("c1", "2026-11-22T11:00:00.000Z")] }),
          );
        }
        return new Response(
          JSON.stringify({
            comments: [
              comment("c2", "2026-11-22T10:00:00.000Z", { page: null }),
              // Blank after trimming, so dropped.
              comment("c3", "2026-11-22T10:30:00.000Z", { name: "   " }),
            ],
          }),
        );
      }),
    ),
  );
});
