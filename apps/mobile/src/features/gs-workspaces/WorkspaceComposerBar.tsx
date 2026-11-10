import {
  COMMON_PRESENTATION_FONTS,
  PRESENTATION_STYLES,
  type PresentationStyle,
  presentationStyle,
  REVIEWER_STYLES,
  resolvePresentationStyle,
  reviewerStyle,
  type WorkspaceSeedSettings,
} from "@t3tools/client-runtime/workspaces";
import type { PresentationStyleChoice, ServerProviderSkill } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { cn } from "../../lib/cn";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import { updateWorkspaceSeedSettings, useWorkspacePreferences } from "./workspacePreferences";

export const MANUSCRIPT_MIME_TYPES = [
  "text/markdown",
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type SeedChange = (patch: Partial<WorkspaceSeedSettings>) => void;

/** Present and Write controls above a new chat's composer; they set this device's defaults. */
export function WorkspaceComposerBar(props: {
  readonly draftKey: string | null;
  readonly providers: ReadonlyArray<{ readonly skills: ReadonlyArray<ServerProviderSkill> }>;
  readonly disabled: boolean;
  readonly onAttachManuscript: () => void;
}) {
  const { active, seedSettings } = useWorkspacePreferences();
  if (active !== "present" && active !== "write") return null;
  const change: SeedChange = (patch) =>
    updateWorkspaceSeedSettings(
      patch,
      props.draftKey === null ? null : { key: props.draftKey, providers: props.providers },
    );
  return (
    <View className="flex-row flex-wrap items-center gap-2 px-3 pt-1">
      {active === "present" ? (
        <PresentStylePicker choice={seedSettings.presentStyle} onChange={change} />
      ) : (
        <>
          <View className="w-44">
            <SegmentedControl
              options={[
                { value: "draft", label: "Draft" },
                { value: "review", label: "Review" },
              ]}
              selected={seedSettings.writeMode}
              onSelect={(writeMode) => change({ writeMode })}
              size="compact"
            />
          </View>
          {seedSettings.writeMode === "review" ? (
            <>
              <ListFilterMenu
                label={`Reviewer: ${reviewerStyle(seedSettings.reviewerStyle).label}`}
                accessibilityLabel="Reviewer style"
                actions={REVIEWER_STYLES.map((style) => ({
                  id: style.id,
                  title: style.label,
                  subtitle: style.description,
                  state: style.id === seedSettings.reviewerStyle ? "on" : "off",
                }))}
                onSelect={(id) => {
                  const next = REVIEWER_STYLES.find((style) => style.id === id);
                  if (next) change({ reviewerStyle: next.id });
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Attach manuscript"
                disabled={props.disabled}
                onPress={props.onAttachManuscript}
                className="min-h-8 flex-row items-center rounded-2xl border border-border px-3 active:opacity-70"
              >
                <Text textRole="footnote" className="font-t3-medium text-foreground">
                  Attach manuscript
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

function StyleSwatch(props: { readonly style: PresentationStyle; readonly large?: boolean }) {
  const { style } = props;
  return (
    <View
      className={cn(
        "overflow-hidden border border-border",
        props.large
          ? "h-14 w-full flex-row items-end justify-between rounded-lg p-2"
          : "size-4 items-center justify-center rounded",
      )}
      style={{ backgroundColor: style.background }}
    >
      {props.large ? (
        <>
          <Text style={{ color: style.text, fontSize: 20, fontWeight: "600" }}>Aa</Text>
          <View className="flex-row gap-1">
            <View className="size-3 rounded-full" style={{ backgroundColor: style.accent }} />
            <View className="size-3 rounded-full" style={{ backgroundColor: style.second }} />
          </View>
        </>
      ) : (
        <View className="size-2 rounded-full" style={{ backgroundColor: style.accent }} />
      )}
    </View>
  );
}

function PresentStylePicker(props: {
  readonly choice: PresentationStyleChoice | null;
  readonly onChange: SeedChange;
}) {
  const [open, setOpen] = useState(false);
  const { choice } = props;
  const resolved = choice === null ? null : resolvePresentationStyle(choice);
  const preset = choice === null ? null : presentationStyle(choice.name);
  const adjusted =
    resolved !== null &&
    preset !== null &&
    (["accent", "second", "background", "headingFont", "bodyFont"] as const).some(
      (key) => resolved[key].toLowerCase() !== preset[key].toLowerCase(),
    );
  const setChoice = (next: PresentationStyleChoice | null) =>
    props.onChange({ presentStyle: next });
  const adjust = (patch: Partial<Omit<PresentationStyleChoice, "name">>) => {
    if (choice !== null) setChoice({ ...choice, ...patch });
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Deck style"
        onPress={() => setOpen(true)}
        className="min-h-8 flex-row items-center gap-2 rounded-2xl border border-border px-3 active:opacity-70"
      >
        {resolved ? <StyleSwatch style={resolved} /> : null}
        <Text textRole="footnote" className="font-t3-medium text-foreground">
          {resolved ? `Style: ${resolved.name}${adjusted ? " (adjusted)" : ""}` : "Choose a style"}
        </Text>
      </Pressable>
      {open ? (
        <Sheet title="Deck style" onClose={() => setOpen(false)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 px-4 pb-10 pt-2"
            keyboardShouldPersistTaps="handled"
          >
            <View accessibilityLabel="Deck styles" className="flex-row flex-wrap gap-2">
              {PRESENTATION_STYLES.map((style) => {
                const selected = choice?.name === style.name;
                return (
                  <Pressable
                    key={style.name}
                    accessibilityRole="button"
                    accessibilityLabel={`${style.name} style`}
                    accessibilityState={{ selected }}
                    onPress={() => setChoice({ name: style.name })}
                    className={cn(
                      "w-[31%] gap-1 rounded-xl p-1.5",
                      selected ? "bg-subtle-strong" : "active:bg-subtle",
                    )}
                  >
                    <StyleSwatch style={style} large />
                    <Text
                      textRole="label"
                      className={cn(
                        "px-0.5",
                        selected ? "font-t3-bold text-foreground" : "text-foreground-muted",
                      )}
                    >
                      {style.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {resolved && preset ? (
              <>
                <Text textRole="footnote" className="text-foreground-muted">
                  {preset.description}
                </Text>
                <View className="gap-3 border-t border-border pt-3">
                  <Text textRole="footnote" className="font-t3-bold text-foreground">
                    Adjust
                  </Text>
                  <HexField
                    key={`accent:${resolved.accent}`}
                    label="Accent"
                    value={resolved.accent}
                    onCommit={(accent) => adjust({ accent })}
                  />
                  <HexField
                    key={`second:${resolved.second}`}
                    label="Second accent"
                    value={resolved.second}
                    onCommit={(second) => adjust({ second })}
                  />
                  <HexField
                    key={`background:${resolved.background}`}
                    label="Background"
                    value={resolved.background}
                    onCommit={(background) => adjust({ background })}
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
                </View>
              </>
            ) : (
              <Text textRole="footnote" className="text-foreground-muted">
                Without a style, the agent suggests a few directions.
              </Text>
            )}
            {choice ? (
              <View className="flex-row items-center justify-between gap-2 border-t border-border pt-3">
                <Button label="No style" tone="text" onPress={() => setChoice(null)} />
                <Button
                  label={`Reset to ${choice.name}`}
                  disabled={!adjusted}
                  onPress={() => setChoice({ name: choice.name })}
                />
              </View>
            ) : null}
          </ScrollView>
        </Sheet>
      ) : null}
    </>
  );
}

/** Keyed by the saved value, so it restarts from it whenever the colour changes elsewhere. */
function HexField(props: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(props.value);
  const commit = () => {
    const next = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
    if (HEX_COLOR.test(next)) props.onCommit(next.toUpperCase());
    else setText(props.value);
  };
  const preview = HEX_COLOR.test(text.trim()) ? text.trim() : props.value;
  return (
    <View className="flex-row items-center gap-3">
      <Text textRole="footnote" className="w-28 text-foreground-muted">
        {props.label}
      </Text>
      <View
        className="size-7 rounded-md border border-border"
        style={{ backgroundColor: preview }}
      />
      <AppTextInput
        accessibilityLabel={`${props.label} hex`}
        className="min-w-0 flex-1 rounded-lg border border-border px-3 py-1.5 text-base text-foreground"
        value={text}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        maxLength={7}
        returnKeyType="done"
        onChangeText={setText}
        onEndEditing={commit}
        onSubmitEditing={commit}
      />
    </View>
  );
}

function FontField(props: {
  readonly label: string;
  readonly value: string;
  readonly presetFont: string;
  readonly onChange: (value: string) => void;
}) {
  const fonts = [...new Set([props.presetFont, props.value, ...COMMON_PRESENTATION_FONTS])];
  return (
    <View className="flex-row items-center gap-3">
      <Text textRole="footnote" className="w-28 text-foreground-muted">
        {props.label}
      </Text>
      <ListFilterMenu
        label={props.value}
        accessibilityLabel={props.label}
        actions={fonts.map((font) => ({
          id: font,
          title: font === props.presetFont ? `${font} (style's own)` : font,
          state: font === props.value ? "on" : "off",
        }))}
        onSelect={props.onChange}
      />
    </View>
  );
}
