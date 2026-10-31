import { afterEach, expect, it, vi } from "vite-plus/test";

// Keep config parsing independent of local env files and build credentials. The config copies
// this env into process.env, so unset names must be omitted rather than stringified to "undefined".
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () =>
    Object.fromEntries(
      ["APP_VARIANT", "T3CODE_MOBILE_EAS_PROJECT_ID", "T3CODE_MOBILE_CLERK_RELYING_PARTY"].flatMap(
        (name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]]),
      ),
    ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined, env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.gradespace.ide", "gradespace"],
  ["development", "com.gradespace.ide.dev", "gradespace-dev"],
  ["preview", "com.gradespace.ide.preview", "gradespace-preview"],
  ["production", "com.gradespace.ide", "gradespace"],
])("keeps the identifiers and scheme for APP_VARIANT=%j", async (value, identifier, scheme) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  expect(config.scheme).toBe(scheme);
});

it("omits account-bound values until they are configured", async () => {
  const config = await loadConfig("production");
  expect(config.owner).toBeUndefined();
  expect(config.ios?.appleTeamId).toBeUndefined();
  expect(config.ios?.associatedDomains).toBeUndefined();
  expect(config.extra?.eas?.projectId).toBeUndefined();
  expect(config.updates).toEqual({ enabled: false });
});

it("wires updates and Clerk domains from env", async () => {
  const config = await loadConfig("production", {
    T3CODE_MOBILE_EAS_PROJECT_ID: "project-id",
    T3CODE_MOBILE_CLERK_RELYING_PARTY: "clerk.example.com",
  });
  expect(config.extra?.eas?.projectId).toBe("project-id");
  expect(config.updates?.url).toBe("https://u.expo.dev/project-id");
  expect(config.ios?.associatedDomains).toEqual([
    "applinks:clerk.example.com",
    "webcredentials:clerk.example.com",
  ]);
});
