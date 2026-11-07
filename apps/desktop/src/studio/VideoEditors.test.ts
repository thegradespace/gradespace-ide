import { assert, describe, it } from "@effect/vitest";

import { pickVideoEditorApps, videoEditorLaunch, videoEditorSearches } from "./VideoEditors.ts";

const installed = (platform: NodeJS.Platform, tree: Record<string, readonly string[]>) =>
  Object.fromEntries(
    pickVideoEditorApps(
      platform,
      videoEditorSearches(platform, { home: "/Users/me", programFiles: "C:\\Program Files" }),
      (folder) => tree[folder] ?? [],
    ),
  );

describe("VideoEditors", () => {
  it("finds each editor's newest install on macOS", () => {
    assert.deepStrictEqual(
      installed("darwin", {
        "/Applications": [
          "DaVinci Resolve.app",
          "Adobe Premiere Pro 2024",
          "Adobe Premiere Pro 2025",
        ],
        "/Applications/Adobe Premiere Pro 2024": ["Adobe Premiere Pro 2024.app"],
        "/Applications/Adobe Premiere Pro 2025": ["Adobe Premiere Pro 2025.app"],
        "/Users/me/Applications": ["Final Cut Pro.app"],
      }),
      {
        resolve: "/Applications/DaVinci Resolve.app",
        premiere: "/Applications/Adobe Premiere Pro 2025/Adobe Premiere Pro 2025.app",
        "final-cut": "/Users/me/Applications/Final Cut Pro.app",
      },
    );
  });

  it("finds Blackmagic's nested Resolve and skips an empty Adobe folder", () => {
    assert.deepStrictEqual(
      installed("darwin", {
        "/Applications": ["DaVinci Resolve", "Adobe Premiere Pro 2025"],
        "/Applications/DaVinci Resolve": ["DaVinci Resolve.app", "Uninstall Resolve.app"],
      }),
      { resolve: "/Applications/DaVinci Resolve/DaVinci Resolve.app" },
    );
  });

  it("finds the programs on Windows", () => {
    assert.deepStrictEqual(
      installed("win32", {
        "C:\\Program Files\\Blackmagic Design": ["DaVinci Resolve"],
        "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve": ["Resolve.exe"],
        "C:\\Program Files\\Adobe": ["Adobe Premiere Pro 2025", "Adobe Photoshop 2025"],
        "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025": ["Adobe Premiere Pro.exe"],
      }),
      {
        resolve: "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\Resolve.exe",
        premiere: "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025\\Adobe Premiere Pro.exe",
      },
    );
    assert.deepStrictEqual(installed("linux", {}), {});
  });

  it("hands the file to editors that import it, and only launches Resolve", () => {
    assert.deepStrictEqual(videoEditorLaunch("darwin", "premiere", "/A/Premiere.app", "/p/a.xml"), {
      command: "open",
      args: ["-a", "/A/Premiere.app", "/p/a.xml"],
      reveal: false,
    });
    assert.deepStrictEqual(
      videoEditorLaunch("darwin", "resolve", "/A/Resolve.app", "/p/a.fcpxml"),
      {
        command: "open",
        args: ["-a", "/A/Resolve.app"],
        reveal: true,
      },
    );
    assert.deepStrictEqual(videoEditorLaunch("win32", "premiere", "C:\\P.exe", "C:\\p\\a.xml"), {
      command: "C:\\P.exe",
      args: ["C:\\p\\a.xml"],
      reveal: false,
    });
  });
});
