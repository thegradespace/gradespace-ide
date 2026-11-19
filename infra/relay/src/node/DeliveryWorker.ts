import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import * as ApnsDeliveries from "../agentActivity/ApnsDeliveries.ts";
import * as ApnsDeliveryQueue from "../agentActivity/ApnsDeliveryQueue.ts";
import type { SignedApnsDeliveryJob } from "../agentActivity/apnsDeliveryJobs.ts";

// The Worker's queue consumer settings, so both runtimes give up on a job alike.
export const APNS_DELIVERY_MAX_RETRIES = 5;
export const APNS_DELIVERY_RETRY_DELAY = "30 seconds";
// Jobs expire after ten minutes and the newest state wins, so a backlog sheds its oldest.
const APNS_DELIVERY_BACKLOG = 1024;

interface QueuedDelivery {
  readonly job: SignedApnsDeliveryJob;
  readonly retries: number;
}

/** Jobs waiting in this process. A restart loses them; the next publish repairs the Live Activity. */
export class ApnsDeliveryBacklog extends Context.Service<
  ApnsDeliveryBacklog,
  Queue.Queue<QueuedDelivery>
>()("t3code-relay/node/DeliveryWorker/ApnsDeliveryBacklog") {
  static readonly layer = Layer.effect(
    ApnsDeliveryBacklog,
    Queue.sliding<QueuedDelivery>(APNS_DELIVERY_BACKLOG),
  );
}

export const layerSender = Layer.effect(
  ApnsDeliveryQueue.ApnsDeliveryQueueSender,
  Effect.gen(function* () {
    const backlog = yield* ApnsDeliveryBacklog;
    return ApnsDeliveryQueue.ApnsDeliveryQueueSender.of({
      send: Effect.fn("ApnsDeliveryQueueSender.send")(function (job) {
        return Effect.asVoid(Queue.offer(backlog, { job, retries: 0 }));
      }),
    });
  }),
);

/** Sends jobs one at a time, in the order they were queued, for as long as the layer lives. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const backlog = yield* ApnsDeliveryBacklog;
    const deliveries = yield* ApnsDeliveries.ApnsDeliveries;
    const scope = yield* Effect.scope;

    const deliver = Effect.fn("relay.apns_delivery_worker.deliver")(function* (
      delivery: QueuedDelivery,
    ) {
      yield* Effect.annotateCurrentSpan({ "relay.delivery.retries": delivery.retries });
      yield* deliveries.processSignedJob(delivery.job).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause)) return Effect.interrupt;
          if (delivery.retries >= APNS_DELIVERY_MAX_RETRIES) {
            return Effect.logError("Dropped an APNs delivery after its last retry", {
              retries: delivery.retries,
              cause,
            });
          }
          // Wait on a separate fiber so one failing job never holds up the ones behind it.
          return Effect.logWarning("APNs delivery failed and will be retried", {
            retries: delivery.retries,
            cause,
          }).pipe(
            Effect.andThen(
              Effect.sleep(APNS_DELIVERY_RETRY_DELAY).pipe(
                Effect.andThen(
                  Queue.offer(backlog, { job: delivery.job, retries: delivery.retries + 1 }),
                ),
                Effect.forkIn(scope),
              ),
            ),
          );
        }),
      );
    });

    yield* Queue.take(backlog).pipe(Effect.flatMap(deliver), Effect.forever, Effect.forkIn(scope));
  }),
);
