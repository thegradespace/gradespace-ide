// @effect-diagnostics nodeBuiltinImport:off -- Only scutil knows the name macOS shows its owner.
import * as NodeChildProcess from "node:child_process";

let cached: string | undefined;

/**
 * What the owner calls this computer, such as "John's MacBook Air". A macOS
 * hostname is a mangled copy ("Johns-MacBook-Air.local"), so ask scutil first.
 */
export function readComputerName(input: {
  readonly platform: NodeJS.Platform;
  readonly hostname: string;
}): string {
  if (cached !== undefined) return cached;
  let name = "";
  if (input.platform === "darwin") {
    try {
      name = NodeChildProcess.execFileSync("scutil", ["--get", "ComputerName"], {
        encoding: "utf8",
        timeout: 2_000,
      }).trim();
    } catch {
      // Fall back to the hostname below.
    }
  }
  cached = name || input.hostname.replace(/\.local$/u, "");
  return cached;
}
