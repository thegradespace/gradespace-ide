import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { SquarePenIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { environmentServerConfigsAtom } from "../state/server";
import { useClientSettings } from "../hooks/useSettings";
import {
  isSkillInstalled,
  workspaceDefinition,
  workspaceSkill,
  type WorkspaceId,
} from "./workspaces.logic";

const MAIL_CONNECTOR_NOTE =
  "Connect Gmail, Google Calendar or Outlook in Claude's connectors (claude.ai → Settings → Connectors), then ask here. Every email is a draft you approve; nothing sends by itself.";

export function WorkspaceNewChatButton(props: {
  workspace: WorkspaceId;
  disabled: boolean;
  shortcutLabel: string | null | undefined;
  onClick: (event: ReactMouseEvent) => void;
}) {
  const { newChatLabel } = workspaceDefinition(props.workspace);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onClick}
            className="mt-1 flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50"
          />
        }
      >
        <SquarePenIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        {newChatLabel}
      </TooltipTrigger>
      <TooltipPopup side="right">
        {props.shortcutLabel ? `${newChatLabel} (${props.shortcutLabel})` : newChatLabel}
      </TooltipPopup>
    </Tooltip>
  );
}

export function WorkspaceInfoCard({ workspace }: { workspace: WorkspaceId }) {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const writeMode = useClientSettings((settings) => settings.writeMode);
  const { opensStudio } = workspaceDefinition(workspace);
  const skill = workspaceSkill(workspace, { writeMode });
  if (skill === null) return null;
  const installed = [...serverConfigs.values()].some((config) =>
    isSkillInstalled(skill, config.providers),
  );
  return (
    <div className="mx-2 mb-2 rounded-xl border border-sidebar-border bg-card/60 p-3 text-xs leading-normal text-muted-foreground">
      {workspace === "mail" ? <p className="mb-2">{MAIL_CONNECTOR_NOTE}</p> : null}
      {installed ? (
        <p>
          Uses <b className="font-semibold text-foreground">{skill}</b>. New chats here start with
          it{opensStudio ? " and open Studio" : ""}.
        </p>
      ) : (
        <p>
          <b className="font-semibold text-foreground">{skill}</b> isn't installed, so new chats
          start without it.{" "}
          <Link to="/settings/skills" className="text-foreground underline underline-offset-2">
            Install skills
          </Link>
        </p>
      )}
    </div>
  );
}
