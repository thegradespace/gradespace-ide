import { useState } from "react";

import {
  desktopCliCommandStateAtom,
  getDesktopCliCommandBridge,
  refreshDesktopCliCommandState,
} from "~/state/desktopCliCommand";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function CliCommandSettingsRow() {
  const bridge = getDesktopCliCommandBridge();
  const query = useEnvironmentQuery(bridge ? desktopCliCommandStateAtom : null);
  const state = query.data;
  const [pending, setPending] = useState(false);

  const change = (action: "install" | "uninstall") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(refreshDesktopCliCommandState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              action === "install"
                ? `Could not install ${state?.commandName ?? "gs"}`
                : `Could not remove ${state?.commandName ?? "gs"}`,
            description: error instanceof Error ? error.message : "Something went wrong.",
          }),
        );
      })
      .finally(() => setPending(false));
  };

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  const name = state.commandName;
  const fallback =
    name === "t3"
      ? ` Ghostscript or another program already uses gs, so the command ${installed ? "is installed" : "installs"} as t3.`
      : "";
  const description = state.shadowedBy
    ? `Another ${name} at ${state.shadowedBy} runs first in a new terminal. Remove it to use Gradespace IDE's.`
    : !installed
      ? `Run Gradespace IDE's CLI as \`${name}\` from any terminal.${fallback}`
      : state.onPath
        ? `Installed at ${state.installedPath}. Open a new terminal to use it.${fallback}`
        : `Installed at ${state.installedPath}, which is not on your PATH yet. Add its folder to your PATH to run \`${name}\`.`;

  return (
    <SettingsRow
      {...searchableSetting("cli-command")}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending || query.isPending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? "Remove" : "Install"}
        </Button>
      }
    />
  );
}
