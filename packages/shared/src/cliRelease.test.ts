import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveTarCommand,
  cliReleaseAssetUrl,
  cliReleaseDownloadBaseUrl,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("has no release source unless a mirror is configured", () => {
    expect(cliReleaseDownloadBaseUrl("1.2.3", undefined)).toBeUndefined();
    expect(cliReleaseDownloadBaseUrl("1.2.3", "  ")).toBeUndefined();
    expect(cliReleaseDownloadBaseUrl("1.2.3", "https://mirror.example/releases/")).toBe(
      "https://mirror.example/releases/v1.2.3",
    );
  });

  it("fetches server runtimes from Gradespace releases unless a mirror is configured", () => {
    expect(cliReleaseAssetUrl("1.2.3", "SHA256SUMS", undefined)).toBe(
      "https://github.com/johnkoko/gradespace-ide-releases/releases/download/v1.2.3/SHA256SUMS",
    );
    expect(cliReleaseAssetUrl("1.2.3", "SHA256SUMS", "  ")).toBe(
      "https://github.com/johnkoko/gradespace-ide-releases/releases/download/v1.2.3/SHA256SUMS",
    );
    expect(cliReleaseAssetUrl("1.2.3", "SHA256SUMS", "https://mirror.example/t3/?sig=x")).toBe(
      "https://mirror.example/t3/v1.2.3/SHA256SUMS?sig=x",
    );
  });
});
