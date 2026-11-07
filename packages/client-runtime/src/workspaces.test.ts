import { describe, expect, it } from "vite-plus/test";

import { presentationStyleLine, reviewerStyleLine } from "./workspaces.ts";

describe("workspace message lines", () => {
  it("names the preset and only the parts that differ from it", () => {
    expect(presentationStyleLine(null)).toBeNull();
    expect(presentationStyleLine({ name: "Unknown" })).toBeNull();
    expect(presentationStyleLine({ name: "Bold" })).toBe("Style: Bold");
    expect(
      presentationStyleLine({
        name: "Bold",
        accent: "#ff5a4e",
        headingFont: "Avenir Next Condensed",
      }),
    ).toBe("Style: Bold");
    expect(
      presentationStyleLine({
        name: "Bold",
        background: "#000000",
        bodyFont: "Inter",
        accent: "#00ff88",
        second: "#FFD23F",
        headingFont: "Futura",
      }),
    ).toBe(
      "Style: Bold · accent #00FF88 · heading font Futura · body font Inter · background #000000",
    );
  });

  it("names the reviewer style by its label", () => {
    expect(reviewerStyleLine("editor-triage")).toBe("Reviewer style: Editor triage");
    expect(reviewerStyleLine("harsh")).toBe("Reviewer style: Harsh");
  });
});
