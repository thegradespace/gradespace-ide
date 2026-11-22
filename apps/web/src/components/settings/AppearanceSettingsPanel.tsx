import type { CSSProperties } from "react";
import { useState } from "react";
import * as Schema from "effect/Schema";
import { msg, useGT, useMessages } from "gt-react";
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type ChatWidth,
  type PanelSide,
  SidebarCollapsedStyle,
  SidebarStyle,
  type TerminalPlacement,
  type EffortDisplay,
  type EnvironmentIdentificationMode,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_OPACITY,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_OPACITY,
  MIN_PANEL_ANIMATION_DURATION_MS,
} from "@t3tools/contracts/settings";
import {
  resolveSidebarStageBackdropVariant,
  type SidebarStageBackdropVariant,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ThemeLibrary } from "./ThemeSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { AdvancedSettings } from "./AdvancedSettings";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";
import { MessageDevicesSettings } from "./MessageDevicesSettings";
import { TypographySection } from "./TypographySettings";
import { ThreadDetailsItemsRow } from "./ThreadDetailsItemsRow";

const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: msg("Artwork"),
  "nightly-artwork": msg("Nightly artwork"),
  "dev-artwork": msg("Dev artwork"),
  pill: msg("Version pill"),
  none: msg("None"),
};

// The default "artwork" follows the running channel, so it is labeled as that channel's art,
// or as "None" on Latest. The other channel's art is offered as a fixed choice.
function environmentIdentificationOptions(
  stageVariant: SidebarStageBackdropVariant | null,
): ReadonlyArray<readonly [EnvironmentIdentificationMode, string]> {
  if (stageVariant === "dev") {
    return [
      ["artwork", msg("Dev artwork")],
      ["nightly-artwork", msg("Nightly artwork")],
      ["pill", msg("Version pill")],
      ["none", msg("None")],
    ];
  }
  if (stageVariant === "nightly") {
    return [
      ["artwork", msg("Nightly artwork")],
      ["dev-artwork", msg("Dev artwork")],
      ["pill", msg("Version pill")],
      ["none", msg("None")],
    ];
  }
  return [
    ["artwork", msg("None")],
    ["nightly-artwork", msg("Nightly artwork")],
    ["dev-artwork", msg("Dev artwork")],
  ];
}

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: msg("Comfortable"),
  wide: msg("Wide"),
  full: msg("Full", { $context: "chat width" }),
};

const PANEL_SIDE_LABELS: Record<PanelSide, string> = {
  right: "Right",
  left: "Left",
};

const isSidebarStyle = Schema.is(SidebarStyle);

const SIDEBAR_STYLE_LABELS: Record<SidebarStyle, string> = {
  dock: "Live dock",
  rail: "Status rail",
  compact: "Compact with filters",
};

const isSidebarCollapsedStyle = Schema.is(SidebarCollapsedStyle);

const SIDEBAR_COLLAPSED_STYLE_LABELS: Record<SidebarCollapsedStyle, string> = {
  "project-dock": "Project dock",
  "slim-rail": "Slim rail",
  "thread-tabs": "Thread tabs",
  "edge-peek": "Edge peek",
};

const TERMINAL_PLACEMENT_LABELS: Record<TerminalPlacement, string> = {
  chat: "Under chat",
  panel: "Under panel",
};

const EFFORT_DISPLAY_LABELS: Record<EffortDisplay, string> = {
  label: msg("Word", { $context: "show effort as a word" }),
  bars: msg("Bars", { $context: "show effort as bars" }),
};

export function AppearanceSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const gt = useGT();
  const m = useMessages();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  const environmentStageVariant = resolveSidebarStageBackdropVariant(environmentStageLabel);
  const environmentIdentificationOptionList =
    environmentIdentificationOptions(environmentStageVariant);
  const environmentIdentificationLabel = m(
    environmentIdentificationOptionList.find(
      ([value]) => value === settings.environmentIdentificationMode,
    )?.[1] ?? ENVIRONMENT_IDENTIFICATION_LABELS[settings.environmentIdentificationMode],
  );
  const effectiveEnvironmentIdentificationMode = useEnvironmentIdentificationMode();
  const themeHidesEnvironmentArtwork =
    effectiveEnvironmentIdentificationMode === "pill" &&
    resolveSidebarStageBackdropVariant(
      environmentStageLabel,
      settings.environmentIdentificationMode,
    ) !== null;
  const environmentIdentificationDescription = themeHidesEnvironmentArtwork
    ? environmentStageVariant
      ? gt("Only built-in themes show artwork, so this theme shows the version pill.")
      : gt("Only built-in themes show artwork.")
    : environmentStageVariant
      ? gt("Choose how Dev and Nightly environments are identified.")
      : gt("Show Dev or Nightly artwork in the sidebar header.");
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;
  const appearanceContrastRatio =
    (settings.appearanceContrast - MIN_APPEARANCE_CONTRAST) /
    (MAX_APPEARANCE_CONTRAST - MIN_APPEARANCE_CONTRAST);
  const appearanceContrastSliderStyle = {
    "--settings-slider-progress": `${appearanceContrastRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - appearanceContrastRatio}rem`,
  } as CSSProperties;
  const panelAnimationDurationRatio =
    (settings.panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection id="appearance" title={gt("Colors & themes")} variant="plain" hideTitle>
        <div id={searchableSetting("theme").id}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="appearance-interface" title={gt("Interface")}>
        <SettingsRow
          {...searchableSetting("setting-appearance-contrast")}
          description={gt("Adjust the contrast of colors and borders across the interface.")}
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                ariaLabel={gt("Reset contrast to default")}
                onClick={() =>
                  updateSettings({
                    appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="appearance-contrast"
              >
                {settings.appearanceContrast}%
              </output>
              <input
                aria-label={gt("Contrast")}
                className="settings-slider min-w-0 flex-1"
                id="appearance-contrast"
                max={MAX_APPEARANCE_CONTRAST}
                min={MIN_APPEARANCE_CONTRAST}
                onChange={(event) => {
                  const appearanceContrast = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(appearanceContrast) &&
                    appearanceContrast >= MIN_APPEARANCE_CONTRAST &&
                    appearanceContrast <= MAX_APPEARANCE_CONTRAST
                  ) {
                    updateSettings({ appearanceContrast });
                  }
                }}
                step={5}
                style={appearanceContrastSliderStyle}
                type="range"
                value={settings.appearanceContrast}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          description={gt("Higher values make menus, dialogs, and the composer more solid.")}
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                ariaLabel={gt("Reset glass opacity to default")}
                onClick={() =>
                  updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label={gt("Glass opacity")}
                className="settings-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) => {
                  const glassOpacity = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(glassOpacity) &&
                    glassOpacity >= MIN_GLASS_OPACITY &&
                    glassOpacity <= MAX_GLASS_OPACITY
                  ) {
                    updateSettings({ glassOpacity });
                  }
                }}
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("chat-width")}
          description={gt("Set how wide messages and the composer can grow on large screens.")}
          resetAction={
            settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
              <SettingResetButton
                ariaLabel={gt("Reset chat width to default")}
                onClick={() => updateSettings({ chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth })}
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.chatWidth}
                onValueChange={(value) => {
                  if (value === "comfortable" || value === "wide" || value === "full")
                    updateSettings({ chatWidth: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label={gt("Chat width")}>
                  <SelectValue>{m(CHAT_WIDTH_LABELS[settings.chatWidth])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="comfortable">{gt("Comfortable (default)")}</SelectItem>
                  <SelectItem value="wide">{m(CHAT_WIDTH_LABELS.wide)}</SelectItem>
                  <SelectItem value="full">{m(CHAT_WIDTH_LABELS.full)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("panel-side")}
          description={gt(
            "Choose which side of the chat the files, diff, and browser panel opens on.",
          )}
          resetAction={
            settings.panelSide !== DEFAULT_UNIFIED_SETTINGS.panelSide ? (
              <SettingResetButton
                ariaLabel={gt("Reset panel position to default")}
                onClick={() => updateSettings({ panelSide: DEFAULT_UNIFIED_SETTINGS.panelSide })}
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.panelSide}
                onValueChange={(value) => {
                  if (value === "right" || value === "left") updateSettings({ panelSide: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Panel position")}
                >
                  <SelectValue>{PANEL_SIDE_LABELS[settings.panelSide]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="right">{gt("Right (default)")}</SelectItem>
                  <SelectItem value="left">Left</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-style")}
          description={gt(
            "Choose how working threads and threads that need you stand out in the sidebar.",
          )}
          resetAction={
            settings.sidebarStyle !== DEFAULT_UNIFIED_SETTINGS.sidebarStyle ? (
              <SettingResetButton
                ariaLabel={gt("Reset sidebar style to default")}
                onClick={() =>
                  updateSettings({ sidebarStyle: DEFAULT_UNIFIED_SETTINGS.sidebarStyle })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.sidebarStyle}
                onValueChange={(value) => {
                  if (isSidebarStyle(value)) updateSettings({ sidebarStyle: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Sidebar style")}
                >
                  <SelectValue>{SIDEBAR_STYLE_LABELS[settings.sidebarStyle]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="dock">{gt("Live dock (default)")}</SelectItem>
                  <SelectItem value="rail">{gt("Status rail")}</SelectItem>
                  <SelectItem value="compact">{gt("Compact with filters")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("workspace-rail")}
          description={gt(
            "Show the icons left of the sidebar for Code, Present, Studio, Research, Write, Mail and QA. Hiding it shows every chat as Code.",
          )}
          resetAction={
            settings.workspaceRailEnabled !== DEFAULT_UNIFIED_SETTINGS.workspaceRailEnabled ? (
              <SettingResetButton
                ariaLabel={gt("Reset workspace rail to default")}
                onClick={() =>
                  updateSettings({
                    workspaceRailEnabled: DEFAULT_UNIFIED_SETTINGS.workspaceRailEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.workspaceRailEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ workspaceRailEnabled: Boolean(checked) })
              }
              aria-label={gt("Show workspace rail")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("sidebar-collapsed-style")}
          description={gt("Choose what stays on screen when the sidebar is collapsed.")}
          resetAction={
            settings.sidebarCollapsedStyle !== DEFAULT_UNIFIED_SETTINGS.sidebarCollapsedStyle ? (
              <SettingResetButton
                ariaLabel={gt("Reset collapsed sidebar to default")}
                onClick={() =>
                  updateSettings({
                    sidebarCollapsedStyle: DEFAULT_UNIFIED_SETTINGS.sidebarCollapsedStyle,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.sidebarCollapsedStyle}
                onValueChange={(value) => {
                  if (isSidebarCollapsedStyle(value))
                    updateSettings({ sidebarCollapsedStyle: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Collapsed sidebar")}
                >
                  <SelectValue>
                    {SIDEBAR_COLLAPSED_STYLE_LABELS[settings.sidebarCollapsedStyle]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="project-dock">{gt("Project dock (default)")}</SelectItem>
                  <SelectItem value="slim-rail">{gt("Slim rail")}</SelectItem>
                  <SelectItem value="thread-tabs">{gt("Thread tabs")}</SelectItem>
                  <SelectItem value="edge-peek">{gt("Edge peek")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("terminal-placement")}
          description={gt(
            "Open the terminal drawer under the chat, or under the panel while it is open.",
          )}
          resetAction={
            settings.terminalPlacement !== DEFAULT_UNIFIED_SETTINGS.terminalPlacement ? (
              <SettingResetButton
                ariaLabel={gt("Reset terminal position to default")}
                onClick={() =>
                  updateSettings({ terminalPlacement: DEFAULT_UNIFIED_SETTINGS.terminalPlacement })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.terminalPlacement}
                onValueChange={(value) => {
                  if (value === "chat" || value === "panel")
                    updateSettings({ terminalPlacement: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Terminal position")}
                >
                  <SelectValue>{TERMINAL_PLACEMENT_LABELS[settings.terminalPlacement]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="chat">{gt("Under chat (default)")}</SelectItem>
                  <SelectItem value="panel">{gt("Under panel")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <ThreadDetailsItemsRow />
        <SettingsRow
          {...searchableSetting("effort-display")}
          description={gt(
            "Show reasoning effort in the composer as its name, such as High, or as bars.",
          )}
          resetAction={
            settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay ? (
              <SettingResetButton
                ariaLabel={gt("Reset effort display to default")}
                onClick={() =>
                  updateSettings({ effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.effortDisplay}
                onValueChange={(value) => {
                  if (value === "bars" || value === "label")
                    updateSettings({ effortDisplay: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Effort display")}
                >
                  <SelectValue>{m(EFFORT_DISPLAY_LABELS[settings.effortDisplay])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="label">{gt("Word (default)")}</SelectItem>
                  <SelectItem value="bars">{m(EFFORT_DISPLAY_LABELS.bars)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("math-rendering")}
          description={gt(
            "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews. The composer keeps TeX source editable.",
          )}
          resetAction={
            settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled ? (
              <SettingResetButton
                ariaLabel={gt("Reset math rendering to default")}
                onClick={() =>
                  updateSettings({
                    mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.mathRenderingEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ mathRenderingEnabled: Boolean(checked) })
              }
              aria-label={gt("Render math")}
            />
          }
        />
        <AdvancedSettings
          targetIds={[
            searchableSetting("panel-animations").id,
            searchableSetting("environment-identification").id,
            // Environment identification's search result lands on this section.
            "appearance-interface",
            searchableSetting("composer-context").id,
          ]}
        >
          <SettingsRow
            {...searchableSetting("panel-animations")}
            description={gt("Set how fast panels open and close.")}
            control={
              <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
                <PanelAnimationsPreview durationMs={settings.panelAnimationDurationMs} />
                <div className="flex w-full items-center gap-3">
                  <output
                    className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                    htmlFor="panel-animation-duration"
                  >
                    {settings.panelAnimationDurationMs} ms
                  </output>
                  <input
                    aria-label={gt("Panel animation duration")}
                    className="settings-slider min-w-0 flex-1"
                    id="panel-animation-duration"
                    max={MAX_PANEL_ANIMATION_DURATION_MS}
                    min={MIN_PANEL_ANIMATION_DURATION_MS}
                    onChange={(event) => {
                      const panelAnimationDurationMs = Number(event.currentTarget.value);
                      if (
                        Number.isInteger(panelAnimationDurationMs) &&
                        panelAnimationDurationMs >= MIN_PANEL_ANIMATION_DURATION_MS &&
                        panelAnimationDurationMs <= MAX_PANEL_ANIMATION_DURATION_MS
                      ) {
                        updateSettings({ panelAnimationDurationMs });
                      }
                    }}
                    step={25}
                    style={panelAnimationDurationSliderStyle}
                    type="range"
                    value={settings.panelAnimationDurationMs}
                  />
                </div>
              </div>
            }
            resetAction={
              settings.panelAnimationDurationMs !==
              DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs ? (
                <SettingResetButton
                  ariaLabel={gt("Reset panel animations to default")}
                  onClick={() =>
                    updateSettings({
                      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
                    })
                  }
                />
              ) : null
            }
          />
          <SettingsRow
            {...searchableSetting("environment-identification")}
            description={environmentIdentificationDescription}
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  ariaLabel={gt("Reset environment identification to default")}
                  onClick={() =>
                    updateSettings({
                      environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.environmentIdentificationMode}
                onValueChange={(value) => {
                  const option = environmentIdentificationOptionList.find(
                    ([optionValue]) => optionValue === value,
                  );
                  if (option) updateSettings({ environmentIdentificationMode: option[0] });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={gt("Environment identification")}
                >
                  <SelectValue>{environmentIdentificationLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {environmentIdentificationOptionList.map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {m(label)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("composer-context")}
            description={gt(
              "Keep branch and worktree controls below the composer after a thread starts.",
            )}
            resetAction={
              settings.persistComposerContextStrip !==
              DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
                <SettingResetButton
                  ariaLabel={gt("Reset composer context to default")}
                  onClick={() =>
                    updateSettings({
                      persistComposerContextStrip:
                        DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.persistComposerContextStrip}
                onCheckedChange={(checked) =>
                  updateSettings({ persistComposerContextStrip: Boolean(checked) })
                }
                aria-label={gt("Keep composer context visible in active threads")}
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>

      <MessageDevicesSettings />

      <TypographySection />
    </SettingsPageContainer>
  );
}
