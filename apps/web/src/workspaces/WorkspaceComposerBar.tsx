import {
  COMMON_PRESENTATION_FONTS,
  PRESENTATION_STYLES,
  REVIEWER_STYLES,
  presentationStyle,
  resolvePresentationStyle,
  reviewerStyle,
  type PresentationStyle,
} from "@t3tools/client-runtime/workspaces";
import type {
  EnvironmentId,
  PresentationStyleChoice,
  ReviewerStyleId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { useRef, useState } from "react";

import type { DraftId } from "../composerDraftStore";
import { useClientSettings } from "../hooks/useSettings";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { updateWorkspaceSeedSettings, useThreadWorkspaces } from "./workspaceStore";
import { WorkspaceSkillNotice } from "./WorkspaceSkillNotice";
import { resolveThreadWorkspace, type WorkspaceSeedSettings } from "./workspaces.logic";

const MANUSCRIPT_ACCEPT = ".md,.markdown,.docx,.pdf,.txt";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const fontStack = (font: string) => `"${font}", system-ui, sans-serif`;

type SeedChange = (patch: Partial<WorkspaceSeedSettings>) => void;

/** A missing-skill notice, and Present and Write defaults, above a new chat's composer. */
export function WorkspaceComposerBar(props: {
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  threadId: string;
  addAttachments: ((files: File[]) => Promise<boolean>) | null;
}) {
  const railEnabled = useClientSettings((settings) => settings.workspaceRailEnabled);
  const threadWorkspaces = useThreadWorkspaces();
  const workspace = resolveThreadWorkspace({ id: props.threadId }, threadWorkspaces);
  if (!railEnabled) return null;
  const change: SeedChange = (patch) =>
    updateWorkspaceSeedSettings(patch, {
      target: props.composerDraftTarget,
      environmentId: props.environmentId,
      workspace,
    });
  const notice = (
    <WorkspaceSkillNotice
      workspace={workspace}
      environmentId={props.environmentId}
      composerDraftTarget={props.composerDraftTarget}
    />
  );
  if (workspace !== "present" && workspace !== "write") {
    return <div className="mb-2 empty:hidden">{notice}</div>;
  }
  return (
    <div className="mb-2 flex min-w-0 flex-col gap-2">
      {notice}
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">
        {workspace === "present" ? (
          <PresentStylePicker onChange={change} />
        ) : (
          <WriteModeControls onChange={change} addAttachments={props.addAttachments} />
        )}
      </div>
    </div>
  );
}

function StyleSwatch({ style, size }: { style: PresentationStyle; size: "sm" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 overflow-hidden border border-black/10 dark:border-white/15",
        size === "sm"
          ? "size-4 items-center justify-center rounded-sm"
          : "h-12 w-full items-end justify-between rounded-md p-1.5",
      )}
      style={{ backgroundColor: style.background, color: style.text }}
    >
      {size === "sm" ? (
        <span className="size-2 rounded-full" style={{ backgroundColor: style.accent }} />
      ) : (
        <>
          <span
            className="text-lg leading-none font-semibold"
            style={{ fontFamily: fontStack(style.headingFont) }}
          >
            Aa
          </span>
          <span className="flex gap-0.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: style.accent }} />
            <span className="size-2.5 rounded-full" style={{ backgroundColor: style.second }} />
          </span>
        </>
      )}
    </span>
  );
}

function PresentStylePicker({ onChange }: { onChange: SeedChange }) {
  const choice = useClientSettings((settings) => settings.presentStyle);
  const resolved = choice === null ? null : resolvePresentationStyle(choice);
  const preset = choice === null ? null : presentationStyle(choice.name);
  const adjusted =
    resolved !== null &&
    preset !== null &&
    (["accent", "second", "background", "headingFont", "bodyFont"] as const).some(
      (key) => resolved[key].toLowerCase() !== preset[key].toLowerCase(),
    );
  const setChoice = (next: PresentationStyleChoice | null) => onChange({ presentStyle: next });
  const adjust = (patch: Partial<Omit<PresentationStyleChoice, "name">>) => {
    if (choice !== null) setChoice({ ...choice, ...patch });
  };

  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="outline" size="xs" aria-label="Deck style" />}
      >
        {resolved ? <StyleSwatch style={resolved} size="sm" /> : null}
        <span className="truncate">
          {resolved ? `Style: ${resolved.name}${adjusted ? " (adjusted)" : ""}` : "Choose a style"}
        </span>
        <ChevronDownIcon className="opacity-70" />
      </PopoverTrigger>
      <PopoverPopup width="md" side="top" align="start" padding="compact">
        <div className="flex flex-col gap-3 text-sm">
          <div role="group" aria-label="Deck styles" className="grid grid-cols-3 gap-2">
            {PRESENTATION_STYLES.map((style) => {
              const selected = choice?.name === style.name;
              return (
                <button
                  key={style.name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setChoice({ name: style.name })}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg p-1 text-left text-xs outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset",
                    selected
                      ? "bg-accent text-foreground ring-1 ring-inset ring-primary/60"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <StyleSwatch style={style} size="lg" />
                  <span className="px-0.5">{style.name}</span>
                </button>
              );
            })}
          </div>
          {resolved && preset ? (
            <>
              <p className="text-xs text-muted-foreground">{preset.description}</p>
              <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
                <legend className="mb-2 text-xs font-medium text-foreground">Adjust</legend>
                <ColorField
                  label="Accent"
                  value={resolved.accent}
                  onChange={(accent) => adjust({ accent })}
                />
                <ColorField
                  label="Second accent"
                  value={resolved.second}
                  onChange={(second) => adjust({ second })}
                />
                <ColorField
                  label="Background"
                  value={resolved.background}
                  onChange={(background) => adjust({ background })}
                />
                <FontField
                  label="Heading font"
                  value={resolved.headingFont}
                  presetFont={preset.headingFont}
                  onChange={(headingFont) => adjust({ headingFont })}
                />
                <FontField
                  label="Body font"
                  value={resolved.bodyFont}
                  presetFont={preset.bodyFont}
                  onChange={(bodyFont) => adjust({ bodyFont })}
                />
              </fieldset>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Without a style, the agent suggests a few directions.
            </p>
          )}
          {choice ? (
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <Button type="button" variant="ghost" size="xs" onClick={() => setChoice(null)}>
                No style
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={!adjusted}
                onClick={() => setChoice({ name: choice.name })}
              >
                Reset to {choice.name}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ColorField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <ColorFieldBody key={props.value} {...props} />;
}

/** Keyed by the saved value, so it restarts from it whenever the colour changes elsewhere. */
function ColorFieldBody(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [preview, setPreview] = useState(props.value);
  const { onChange } = props;
  // React's onChange fires on every drag step; the native change event fires once, on release.
  const commitOnRelease = (node: HTMLInputElement | null) => {
    if (node === null) return;
    const commit = () => onChange(node.value.toUpperCase());
    node.addEventListener("change", commit);
    return () => node.removeEventListener("change", commit);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{props.label}</span>
      <input
        ref={commitOnRelease}
        type="color"
        aria-label={`${props.label} colour`}
        value={preview.toLowerCase()}
        onChange={(event) => setPreview(event.currentTarget.value.toUpperCase())}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
      />
      <HexField key={preview} label={props.label} value={preview} onCommit={onChange} />
    </div>
  );
}

function HexField(props: { label: string; value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value);
  const commit = () => {
    const next = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
    if (HEX_COLOR.test(next)) props.onCommit(next.toUpperCase());
    else setText(props.value);
  };
  return (
    <div className="min-w-0 flex-1">
      <Input
        size="compact"
        aria-label={`${props.label} hex`}
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}

function FontField(props: {
  label: string;
  value: string;
  presetFont: string;
  onChange: (value: string) => void;
}) {
  const fonts = [...new Set([props.presetFont, props.value, ...COMMON_PRESENTATION_FONTS])];
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{props.label}</span>
      <div className="min-w-0 flex-1">
        <Select
          value={props.value}
          onValueChange={(value) => {
            if (typeof value === "string") props.onChange(value);
          }}
        >
          <SelectTrigger size="sm" className="w-full min-w-0" aria-label={props.label}>
            <SelectValue>{props.value}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {fonts.map((font) => (
              <SelectItem key={font} value={font}>
                <span style={{ fontFamily: fontStack(font) }}>
                  {font}
                  {font === props.presetFont ? " (style's own)" : ""}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </div>
  );
}

function WriteModeControls(props: {
  onChange: SeedChange;
  addAttachments: ((files: File[]) => Promise<boolean>) | null;
}) {
  const mode = useClientSettings((settings) => settings.writeMode);
  const style = useClientSettings((settings) => settings.reviewerStyle);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addAttachments } = props;
  return (
    <>
      <ToggleGroup
        aria-label="Write mode"
        value={[mode]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "draft" || value === "review") props.onChange({ writeMode: value });
        }}
      >
        <Toggle value="draft">Draft</Toggle>
        <Toggle value="review">Review</Toggle>
      </ToggleGroup>
      {mode === "review" ? (
        <>
          <div className="min-w-40 max-w-56 flex-1">
            <Select
              value={style}
              onValueChange={(value) => {
                const next = REVIEWER_STYLES.find((candidate) => candidate.id === value);
                if (next) props.onChange({ reviewerStyle: next.id });
              }}
            >
              <SelectTrigger size="xs" className="w-full min-w-0" aria-label="Reviewer style">
                <SelectValue>{`Reviewer: ${reviewerStyle(style).label}`}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false} matchTriggerWidth={false}>
                {REVIEWER_STYLES.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id satisfies ReviewerStyleId}>
                    <span className="flex max-w-72 flex-col py-0.5">
                      <span>{candidate.label}</span>
                      <span className="text-xs text-muted-foreground">{candidate.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          {addAttachments ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept={MANUSCRIPT_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  if (files.length > 0) void addAttachments(files);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => inputRef.current?.click()}
              >
                <FileTextIcon />
                Attach manuscript
              </Button>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
