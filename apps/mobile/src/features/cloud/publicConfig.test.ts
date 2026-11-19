import { describe, expect, it, vi } from "vite-plus/test";

import { resolveCloudPublicConfig, resolveConnectAuthMode } from "./publicConfig";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe("resolveCloudPublicConfig", () => {
  it("rejects an insecure relay URL", () => {
    expect(
      resolveCloudPublicConfig({
        clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" },
        relay: { url: "http://relay.example.test" },
      }),
    ).toEqual({
      clerk: {
        publishableKey: "pk_test_example",
        jwtTemplate: "t3-relay",
      },
      relay: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });
});

describe("resolveConnectAuthMode", () => {
  it.each([
    { label: "no relay", clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" } },
    { label: "a relay alone", relay: "https://relay.example.test", mode: "owner" },
    {
      label: "a relay with Clerk",
      relay: "https://relay.example.test",
      clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" },
      mode: "clerk",
    },
    {
      label: "a relay with a Clerk key but no JWT template",
      relay: "https://relay.example.test",
      clerk: { publishableKey: "pk_test_example" },
    },
  ])("picks the mode from the build config: $label", (input) => {
    expect(
      resolveConnectAuthMode(
        resolveCloudPublicConfig({ clerk: input.clerk ?? {}, relay: { url: input.relay } }),
      ),
    ).toBe(input.mode ?? null);
  });
});
