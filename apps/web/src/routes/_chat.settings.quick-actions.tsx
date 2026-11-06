import { createFileRoute } from "@tanstack/react-router";

import { QuickActionsSettingsPanel } from "../components/settings/QuickActionsSettings";

function SettingsQuickActionsRoute() {
  const search = Route.useSearch();
  return <QuickActionsSettingsPanel startNew={search.new === true} />;
}

export const Route = createFileRoute("/_chat/settings/quick-actions")({
  validateSearch: (raw: Record<string, unknown>): { new?: true } =>
    raw.new === true || raw.new === "true" ? { new: true } : {},
  component: SettingsQuickActionsRoute,
});
