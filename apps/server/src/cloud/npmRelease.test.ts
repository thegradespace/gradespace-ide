import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as NpmRelease from "./npmRelease.ts";

it.effect("never answers a release lookup, since Gradespace publishes no npm package", () =>
  Effect.gen(function* () {
    const service = yield* NpmRelease.make();
    const found = yield* service.get({ spec: "latest" }).pipe(Effect.result);
    expect(Result.isFailure(found)).toBe(true);
    if (Result.isFailure(found)) {
      expect(found.failure).toBeInstanceOf(ServerNpmReleaseError);
      expect(found.failure.message).toContain(NpmRelease.NPM_RELEASE_UNAVAILABLE_REASON);
    }
  }),
);
