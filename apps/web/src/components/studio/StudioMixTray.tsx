import { X } from "lucide-react";

import { Button } from "~/components/ui/button";

import type { StudioManifest } from "./studioManifest";
import { PinMarker } from "./StudioPinLayer";
import type { StudioPin } from "./studioPins";

/** Parts kept across options for a mix, and the button that asks for the mixed option. */
export function StudioMixTray(props: {
  readonly manifest: StudioManifest;
  /** Kept parts, in the order they were placed. */
  readonly parts: readonly StudioPin[];
  readonly keeping: boolean;
  readonly onRemove: (id: number) => void;
  readonly onClear: () => void;
  readonly onMix: () => void;
}) {
  const options = new Set(props.parts.map((part) => part.variantId));
  const order = new Map(props.manifest.variants.map((variant, index) => [variant.id, index]));
  const parts = [...props.parts].sort(
    (a, b) => (order.get(a.variantId) ?? 0) - (order.get(b.variantId) ?? 0) || a.id - b.id,
  );
  const hint =
    props.parts.length === 0
      ? "Click a part of any option to keep it, such as a header or a pricing table."
      : options.size < 2
        ? "Keep a part from at least one more option to mix them."
        : null;
  return (
    <section
      aria-label="Parts to mix"
      className="flex w-full flex-col gap-1.5 rounded-lg border bg-card p-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">Mix options</span>
        {props.parts.length > 0 ? (
          <span className="text-muted-foreground">
            {props.parts.length === 1 ? "1 part" : `${props.parts.length} parts`} from{" "}
            {options.size === 1 ? "1 option" : `${options.size} options`}
          </span>
        ) : null}
      </div>
      {parts.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {parts.map((part) => {
            const label = `${part.variantId}${part.version === null ? "" : ` v${part.version}`}`;
            const element = part.page?.text || part.page?.selector || "";
            return (
              <li key={part.id} className="flex items-start gap-1.5">
                <PinMarker label={part.number} kind="keep" />
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-medium">{label}</span>
                  {element ? <span className="text-muted-foreground"> · {element}</span> : null}
                  {part.comment ? <span>: {part.comment}</span> : null}
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove kept part ${part.number} from option ${label}`}
                  onClick={() => props.onRemove(part.id)}
                >
                  <X className="size-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {hint !== null ? <p className="text-muted-foreground">{hint}</p> : null}
      <div className="flex justify-end gap-1.5">
        {props.parts.length > 0 ? (
          <Button type="button" size="xs" variant="ghost" onClick={props.onClear}>
            Clear
          </Button>
        ) : null}
        <Button type="button" size="xs" disabled={options.size < 2} onClick={props.onMix}>
          Mix these
        </Button>
      </div>
    </section>
  );
}
