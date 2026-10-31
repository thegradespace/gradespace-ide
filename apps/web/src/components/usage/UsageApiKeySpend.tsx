import {
  type EnvironmentId,
  type ServerProvider,
  UsageDay,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import { useEffect, useEffectEvent, useState } from "react";

import { useUsage } from "../../state/usage";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";

type ProviderPresentations = ReadonlyMap<
  EnvironmentId,
  { readonly serverConfig: { readonly providers: ReadonlyArray<ServerProvider> } | null }
>;

const USAGE_KIND_BY_DRIVER = new Map(
  PROVIDER_ORDER.map((kind) => [PROVIDER_PRESENTATION[kind].driverKind, kind] as const),
);

function monthToDate(now: number) {
  const today = makeWindow(1, new Date(now));
  return { ...today, sinceDay: UsageDay.make(`${today.untilDay.slice(0, 8)}01`) };
}

/** API keys have no subscription windows, so show their estimated spend instead. */
export function UsageApiKeySpend({
  presentations,
  selectedEnvironmentIds,
  now,
}: {
  readonly presentations: ProviderPresentations;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly now: number;
}) {
  const apiKeyKinds = new Map<EnvironmentId, Set<UsageProviderKind>>();
  for (const [environmentId, presentation] of presentations) {
    for (const provider of presentation.serverConfig?.providers ?? []) {
      const kind = USAGE_KIND_BY_DRIVER.get(provider.driver);
      if (!kind || !provider.enabled || provider.auth.type !== "apiKey") continue;
      const kinds = apiKeyKinds.get(environmentId) ?? new Set();
      kinds.add(kind);
      apiKeyKinds.set(environmentId, kinds);
    }
  }
  if (apiKeyKinds.size === 0) return null;
  return (
    <ApiKeySpendSections
      apiKeyKinds={apiKeyKinds}
      selectedEnvironmentIds={selectedEnvironmentIds}
      now={now}
    />
  );
}

function ApiKeySpendSections({
  apiKeyKinds,
  selectedEnvironmentIds,
  now,
}: {
  readonly apiKeyKinds: ReadonlyMap<EnvironmentId, ReadonlySet<UsageProviderKind>>;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly now: number;
}) {
  const window = monthToDate(now);
  const { selectedEnvironments, refresh } = useUsage(window, selectedEnvironmentIds);
  const [mountedAt] = useState(now);
  const rescan = useEffectEvent(() => void refresh());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- rescans transcripts when the Limits refresh advances now; mount already reads them
  useEffect(() => {
    if (now !== mountedAt) rescan();
  }, [now, mountedAt]);

  const spend = new Map<UsageProviderKind, { today: number; month: number; pending: boolean }>();
  for (const environment of selectedEnvironments) {
    const kinds = apiKeyKinds.get(environment.environmentId);
    if (!kinds) continue;
    for (const kind of kinds) {
      const entry = spend.get(kind) ?? { today: 0, month: 0, pending: false };
      if (environment.summary === null && environment.isPending) entry.pending = true;
      spend.set(kind, entry);
    }
    for (const bucket of environment.summary?.buckets ?? []) {
      const entry = spend.get(bucket.provider);
      if (!entry || !kinds.has(bucket.provider)) continue;
      entry.month += bucket.costUsd;
      if (bucket.day === window.untilDay) entry.today += bucket.costUsd;
    }
  }

  return PROVIDER_ORDER.flatMap((kind) => {
    const entry = spend.get(kind);
    if (!entry) return [];
    const driver = PROVIDER_PRESENTATION[kind].driverKind;
    const label = providerClients.get(driver)?.label ?? PROVIDER_PRESENTATION[kind].label;
    const format = (value: number) => (entry.pending ? "…" : formatUsd(value));
    return [
      <section key={kind} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ProviderInstanceIcon
            driverKind={driver}
            displayName={label}
            indicatorBackground="var(--background)"
            className="size-5"
            iconClassName="size-4 text-foreground/80"
          />
          {label}
          <span className="font-normal text-muted-foreground">· API key</span>
        </h2>
        <div className="grid gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 sm:grid-cols-2">
          <SpendStat label="Today" value={format(entry.today)} />
          <SpendStat label="This month" value={format(entry.month)} />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Estimated from session logs at API prices. Your provider's billing page has the exact
            amount.
          </p>
        </div>
      </section>,
    ];
  });
}

function SpendStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-3xl font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}
