import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import * as ApnsDeliveries from "../agentActivity/ApnsDeliveries.ts";
import * as ApnsDeliveryQueue from "../agentActivity/ApnsDeliveryQueue.ts";
import type { SignedApnsDeliveryJob } from "../agentActivity/apnsDeliveryJobs.ts";
import * as DeliveryWorker from "./DeliveryWorker.ts";

// The worker passes jobs through unread, so a label is enough to tell them apart.
const job = (label: string) => ({ label }) as unknown as SignedApnsDeliveryJob;
const labelOf = (body: unknown) => (body as { readonly label: string }).label;

describe("DeliveryWorker", () => {
  it.effect("retries a failing job every 30 seconds, then drops it after the fifth retry", () =>
    Effect.gen(function* () {
      const attempts = yield* Queue.unbounded<string>();
      const layer = Layer.merge(DeliveryWorker.layer, DeliveryWorker.layerSender).pipe(
        Layer.provide(DeliveryWorker.ApnsDeliveryBacklog.layer),
        Layer.provide(
          Layer.mock(ApnsDeliveries.ApnsDeliveries, {
            processSignedJob: (body) =>
              Queue.offer(attempts, labelOf(body)).pipe(
                Effect.andThen(
                  labelOf(body) === "failing"
                    ? Effect.fail(
                        new ApnsDeliveries.ApnsDeliveryJobClaimInFlight({ sourceJobId: "failing" }),
                      )
                    : Effect.succeed({
                        deviceId: "device-1",
                        kind: "push_notification" as const,
                        ok: true,
                        apnsStatus: 200,
                        apnsReason: null,
                        apnsId: null,
                      }),
                ),
              ),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const sender = yield* ApnsDeliveryQueue.ApnsDeliveryQueueSender;
        yield* sender.send(job("failing"));
        expect(yield* Queue.take(attempts)).toBe("failing");

        // The retry is not due yet, and waiting for it does not hold up the next job.
        yield* TestClock.adjust("29 seconds");
        yield* sender.send(job("other"));
        expect(yield* Queue.take(attempts)).toBe("other");

        yield* TestClock.adjust("1 second");
        expect(yield* Queue.take(attempts)).toBe("failing");
        for (let retry = 2; retry <= 5; retry++) {
          yield* TestClock.adjust("30 seconds");
          expect(yield* Queue.take(attempts)).toBe("failing");
        }

        // Dropped: a sixth retry would be queued ahead of this job.
        yield* TestClock.adjust("5 minutes");
        yield* sender.send(job("after the drop"));
        expect(yield* Queue.take(attempts)).toBe("after the drop");
      }).pipe(Effect.provide(layer));
    }),
  );
});
