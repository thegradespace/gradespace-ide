import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  emailProviderRows,
  isMailQuickJobPrompt,
  MAIL_QUICK_JOBS,
  mailQuickJobPrompt,
  preferredEmailProvider,
} from "./mailHome.ts";

const provider = (id: string, driver: string, enabled = true, displayName?: string) => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make(driver),
  enabled,
  ...(displayName === undefined ? {} : { displayName }),
});

describe("emailProviderRows", () => {
  const providers = [
    provider("codex", "codex"),
    provider("claudeAgent", "claudeAgent"),
    provider("claude_work", "claudeAgent", true, "Claude (work)"),
    provider("cursor", "cursor"),
    provider("codex_off", "codex", false),
  ];

  it("keeps enabled Codex and Claude instances and takes each one's reported state", () => {
    const rows = emailProviderRows(providers, {
      providers: [
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          state: "connected",
          connectors: ["Gmail"],
        },
        {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          state: "notConnected",
          connectors: [],
        },
      ],
    });
    expect(rows.map((row) => [row.instanceId, row.label, row.state])).toEqual([
      ["codex", "Codex", "connected"],
      ["claudeAgent", "Claude", "notConnected"],
      ["claude_work", "Claude (work)", "unknown"],
    ]);
  });

  it("reports unknown for every row when the server has no report", () => {
    expect(emailProviderRows(providers, null).map((row) => row.state)).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);
  });
});

describe("preferredEmailProvider", () => {
  const rows = emailProviderRows(
    [provider("codex", "codex"), provider("claudeAgent", "claudeAgent")],
    {
      providers: [
        {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          state: "connected",
          connectors: ["Gmail"],
        },
      ],
    },
  );

  it("keeps a connected current provider and otherwise picks the first connected one", () => {
    expect(preferredEmailProvider(rows, ProviderInstanceId.make("claudeAgent"))).toBeNull();
    expect(preferredEmailProvider(rows, ProviderInstanceId.make("codex"))).toBe("claudeAgent");
    expect(preferredEmailProvider(rows, null)).toBe("claudeAgent");
    expect(
      preferredEmailProvider(emailProviderRows([provider("codex", "codex")], null), null),
    ).toBeNull();
  });
});

it("starts a quick job with gs-mail only when it is installed", () => {
  const triage = MAIL_QUICK_JOBS[0]!;
  expect(mailQuickJobPrompt(triage, true)).toBe(
    "$gs-mail Triage my inbox: what needs me today? Drafts only.",
  );
  expect(mailQuickJobPrompt(triage, false)).toBe(
    "Triage my inbox: what needs me today? Drafts only.",
  );
  expect(isMailQuickJobPrompt(`${mailQuickJobPrompt(triage, true)}\n`)).toBe(true);
  expect(isMailQuickJobPrompt(`${mailQuickJobPrompt(triage, true)} and Bob`)).toBe(false);
});
