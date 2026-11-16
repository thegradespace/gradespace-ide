import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, ChevronRightIcon, SquarePenIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { environmentServerConfigsAtom } from "../state/server";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useClientSettings } from "../hooks/useSettings";
import {
  isSkillInstalled,
  workspaceDefinition,
  workspaceSkill,
  type WorkspaceId,
} from "./workspaces.logic";

const MAIL_CONNECTOR_NOTE =
  "Mail works through your agent's own email connection: Gmail in Codex's plugins or Claude's connectors. A new email shows which are connected. Every email is a draft you approve; nothing sends by itself.";

const COLLAPSED_INFO_KEY = "t3code:workspace-info-collapsed";
const CollapsedWorkspaces = Schema.Array(Schema.String);
const NO_COLLAPSED_WORKSPACES: ReadonlyArray<string> = [];

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
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useLocalStorage(
    COLLAPSED_INFO_KEY,
    NO_COLLAPSED_WORKSPACES,
    CollapsedWorkspaces,
  );
  const { label, opensStudio } = workspaceDefinition(workspace);
  const skill = workspaceSkill(workspace, { writeMode });
  if (skill === null) return null;
  const installed = [...serverConfigs.values()].some((config) =>
    isSkillInstalled(skill, config.providers),
  );
  // A missing skill changes what new chats do, so that notice cannot be folded away.
  const collapsed = installed && collapsedWorkspaces.includes(workspace);
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <div className="mx-2 mb-2 rounded-xl border border-sidebar-border bg-card/60 text-xs leading-normal text-muted-foreground">
      {installed ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() =>
            setCollapsedWorkspaces((current) =>
              current.includes(workspace)
                ? current.filter((id) => id !== workspace)
                : [...current, workspace],
            )
          }
          className="flex h-8 w-full items-center gap-1.5 rounded-xl px-3 text-left outline-hidden ring-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset"
        >
          <Chevron aria-hidden className="size-3.5 shrink-0" />
          About {label}
        </button>
      ) : null}
      {collapsed ? null : (
        <div className={installed ? "px-3 pb-3" : "p-3"}>
          {workspace === "mail" ? <p className="mb-2">{MAIL_CONNECTOR_NOTE}</p> : null}
          {installed ? (
            <p>
              Uses <b className="font-semibold text-foreground">{skill}</b>. New chats here start
              with it{opensStudio ? " and open Studio" : ""}.
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
      )}
    </div>
  );
}
