import {
  ServerNpmReleaseError,
  type ServerNpmRelease,
  type ServerNpmReleaseInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

/** Gradespace publishes no npm package, so release lookups are never answered from a registry. */
export const NPM_RELEASE_UNAVAILABLE_REASON =
  "Release lookups are not available: Gradespace IDE updates through the Mac app from https://thegradespace.com/ide.";

export const make = Effect.fn("NpmRelease.make")(function* () {
  return NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* () {
      return yield* new ServerNpmReleaseError({ reason: NPM_RELEASE_UNAVAILABLE_REASON });
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make());
