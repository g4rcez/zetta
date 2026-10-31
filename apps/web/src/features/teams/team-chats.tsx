import { useNavigate } from "@tanstack/react-router";
import { HashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { cn } from "@zetta/ui/lib/utils";

import { errorMessage } from "../chat/chat-client";
import { teamsApi, type Team } from "./teams-api";

/**
 * Sidebar rows for the teams that can hold a room (a chief and one more bot) and have no live room yet. Opening one starts the
 * team's room, where the chief answers first. A team with a live room is listed as that room instead.
 */
export function TeamRoomRows({
  hasRoom,
  query,
  rowClass,
}: {
  hasRoom: (teamId: string) => boolean;
  /** Lower-case filter text from the sidebar. */
  query: string;
  rowClass: string;
}) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  useEffect(() => {
    void teamsApi
      .list()
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);
  const open = async (id: string) => {
    try {
      await navigate({ to: "/rooms", search: { id: await teamsApi.chat(id) } });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return teams
    .filter((t) => t.members.length > 1 && !hasRoom(t.id) && t.name.toLowerCase().includes(query))
    .map((t) => (
      <li key={t.id}>
        <button
          type="button"
          data-chat-row
          onClick={() => void open(t.id)}
          className={cn(
            rowClass,
            "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <HashIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
        </button>
      </li>
    ));
}
