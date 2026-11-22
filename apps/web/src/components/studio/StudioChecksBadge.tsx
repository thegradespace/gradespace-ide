import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";

import type { StudioCheckIssue, StudioCheckKind } from "./studioChecks";
import type { StudioVariant } from "./studioManifest";
import type { StudioContext } from "./StudioVariantPreview";
import { useStudioChecks } from "./useStudioChecks";

const KIND_LABEL: Record<StudioCheckKind, string> = {
  contrast: "Contrast",
  accessibility: "Accessibility",
  links: "Links",
};

const MAX_LISTED = 40;

function IssueList(props: {
  readonly issues: readonly StudioCheckIssue[];
  readonly onHighlight: ((selector: string) => void) | undefined;
}) {
  const shown = props.issues.slice(0, MAX_LISTED);
  return (
    <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto text-xs">
      {shown.map((issue, index) => {
        const label = (
          <>
            <span className="shrink-0 text-muted-foreground">{KIND_LABEL[issue.kind]}</span>
            <span className="min-w-0 break-words">{issue.message}</span>
          </>
        );
        const selector = issue.selector;
        return (
          // oxlint-disable-next-line react/no-array-index-key -- issues have no id and can repeat
          <li key={index}>
            {props.onHighlight !== undefined && selector !== null ? (
              <button
                type="button"
                className="flex w-full cursor-pointer gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => props.onHighlight?.(selector)}
              >
                {label}
              </button>
            ) : (
              <div className="flex gap-2 px-1.5 py-1">{label}</div>
            )}
          </li>
        );
      })}
      {props.issues.length > shown.length ? (
        <li className="px-1.5 py-1 text-muted-foreground">
          And {props.issues.length - shown.length} more
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Small result of the automatic checks on an HTML option, opening a list of what they found.
 * Shows nothing for other kinds of option, or while the checks have not finished.
 */
export function StudioChecksBadge(
  props: StudioContext & {
    readonly setPath: string;
    /** The option at the version on show. */
    readonly variant: StudioVariant;
    readonly optionLabel: string;
    readonly onHighlight?: ((selector: string) => void) | undefined;
    readonly onAskToFix: (issues: readonly StudioCheckIssue[]) => void;
  },
) {
  const state = useStudioChecks(props, props.variant);
  const [open, setOpen] = useState(false);
  const onHighlight = props.onHighlight;
  if (state === null || state.status === "failed") return null;
  if (state.status === "pending") {
    return (
      <Badge variant="outline" size="sm" aria-label={`Checking option ${props.optionLabel}`}>
        Checking…
      </Badge>
    );
  }
  const count = state.issues.length;
  if (count === 0) {
    return (
      <Badge variant="success" size="sm">
        Checks pass
      </Badge>
    );
  }
  const label = count === 1 ? "1 issue" : `${count} issues`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Badge
            variant="warning"
            size="sm"
            render={<button type="button" />}
            aria-label={`${label} found by checks on option ${props.optionLabel}`}
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="end">
        <div className="flex flex-col gap-2">
          <PopoverTitle>
            Checks on option {props.optionLabel}: {label}
          </PopoverTitle>
          <IssueList
            issues={state.issues}
            onHighlight={
              onHighlight === undefined
                ? undefined
                : (selector) => {
                    // Close the list so the outlined element is not under it.
                    setOpen(false);
                    onHighlight(selector);
                  }
            }
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="xs"
              onClick={() => {
                setOpen(false);
                props.onAskToFix(state.issues);
              }}
            >
              Ask to fix these
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
