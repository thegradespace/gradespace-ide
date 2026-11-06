import { defaultQuickActionsFor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ALL_IMPROVE_STEPS,
  buildImprovePrompt,
  findQuickActionForEvent,
  isReservedQuickActionShortcut,
} from "./quickActions.logic";

const base = { opening: "$gs-improve", folder: "/work/app", focus: "" };

describe("buildImprovePrompt", () => {
  it("lists every step and asks for approval before building", () => {
    expect(buildImprovePrompt({ ...base, steps: ALL_IMPROVE_STEPS })).toBe(
      [
        "$gs-improve Reassess and improve the project at /work/app.",
        "Steps:",
        "- Research: Compare with similar products and current guidance.",
        "- Review the code: Product, frontend and backend review.",
        "- Test it for real: Run it and click through the main flows.",
        "- Improve the words: Headlines, buttons, empty states, errors.",
        "- Show UI designs in Studio: Before and after, you pick.",
        "Then build what I approve on a new branch, with checks and QA. Stop for my approval before building anything.",
      ].join("\n"),
    );
  });

  it("names skipped steps, the focus and where to stop without a build", () => {
    const prompt = buildImprovePrompt({
      ...base,
      focus: "  the pricing page ",
      steps: { ...ALL_IMPROVE_STEPS, research: false, words: false, build: false },
    });
    expect(prompt).toContain("Focus: the pricing page\n");
    expect(prompt).toContain("Skip: research, the copy.");
    expect(prompt).not.toContain("- Research");
    expect(prompt.endsWith("Do not build; stop after the designs.")).toBe(true);
  });

  it("stops after the proposals when neither designs nor a build are wanted", () => {
    const prompt = buildImprovePrompt({
      ...base,
      opening: "  ",
      steps: { ...ALL_IMPROVE_STEPS, designs: false, build: false },
    });
    expect(prompt.startsWith("$gs-improve ")).toBe(true);
    expect(prompt.endsWith("Do not build; stop after the ranked proposals.")).toBe(true);
  });
});

describe("findQuickActionForEvent", () => {
  const key = (init: Partial<KeyboardEventInit> & { key: string; code?: string }) => ({
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  });

  it("matches Option+Cmd+digit on macOS, where Option changes the typed character", () => {
    const event = key({ key: "™", code: "Digit2", metaKey: true, altKey: true });
    expect(findQuickActionForEvent(event, defaultQuickActionsFor(true), "MacIntel")?.id).toBe("qa");
  });

  it("uses Ctrl+Shift+digit elsewhere, so AltGr text entry never runs an action", () => {
    const actions = defaultQuickActionsFor(false);
    const shifted = key({ key: "@", code: "Digit2", ctrlKey: true, shiftKey: true });
    expect(findQuickActionForEvent(shifted, actions, "Win32")?.id).toBe("qa");
    const altGr = {
      ...key({ key: "²", code: "Digit2", ctrlKey: true, altKey: true }),
      getModifierState: (modifier: "AltGraph") => modifier === "AltGraph",
    };
    expect(findQuickActionForEvent(altGr, actions, "Win32")).toBeNull();
  });
});

describe("isReservedQuickActionShortcut", () => {
  it("refuses the macOS log out chord in any spelling", () => {
    expect(isReservedQuickActionShortcut("mod+shift+q", "MacIntel")).toBe(true);
    expect(isReservedQuickActionShortcut("meta+shift+q", "MacIntel")).toBe(true);
    expect(isReservedQuickActionShortcut("mod+shift+i", "MacIntel")).toBe(false);
  });
});
