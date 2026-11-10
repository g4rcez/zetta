import { ArrowLeftIcon, CrownIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { discussionsApi, type RoomTask, type RoomTurn } from "../discussions/discussions-api";
import { Badge, Empty, Loading } from "../shared/ui";
import { TeamPeoplePanel } from "./team-people";
import { teamsApi, teamsQueries, type Team, type TeamMember } from "./teams-api";

export type TeamTab = "chat" | "work" | "members";
export const TEAM_TABS: { id: TeamTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "work", label: "Work" },
  { id: "members", label: "Members" },
];

const TURN_LABEL: Record<
  string,
  { label: string; tone: "info" | "neutral" | "warning" | "danger" | "success" }
> = {
  running: { label: "Working", tone: "info" },
  queued: { label: "Waiting", tone: "neutral" },
  awaiting_approval: { label: "Waiting for you", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  done: { label: "Idle", tone: "success" },
};

/** One member's lane: what it is doing now (its latest turn and step in the team chat) and the tasks it holds. */
function MemberLane({
  m,
  turn,
  tasks,
}: {
  m: TeamMember;
  turn: RoomTurn | undefined;
  tasks: RoomTask[];
}) {
  const state = TURN_LABEL[turn?.status ?? "done"] ?? TURN_LABEL.done!;
  const step = turn?.status === "running" ? turn.steps.at(-1)?.label : undefined;
  return (
    <li className="space-y-2 rounded-lg border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0 truncate">{m.name}</strong>
        {m.kind === "chief" && (
          <Badge tone="warning">
            <CrownIcon className="mr-1 size-3" aria-hidden="true" />
            Lead
          </Badge>
        )}
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      {step && <p className="text-xs text-muted-foreground">Now: {step}</p>}
      {tasks.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          {tasks.map((t) => (
            <li key={t.id}>
              {t.title}{" "}
              <span className="text-muted-foreground">({t.status.replace("_", " ")})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No open tasks.</p>
      )}
    </li>
  );
}

/** What every member is doing in the team's chat, refreshed while the page is open. */
function WorkTab({ team }: { team: Team }) {
  const home = useQuery({
    queryKey: ["teams", team.id, "home"],
    queryFn: () => teamsApi.chat(team.id),
    staleTime: 60_000,
  });
  const steps = useQuery({
    queryKey: ["teams", team.id, "work", home.data],
    queryFn: () => discussionsApi.steps(home.data!),
    enabled: Boolean(home.data),
    refetchInterval: 5000,
  });
  if (home.error || steps.error)
    return <Alert theme="danger">{errorMessage(home.error ?? steps.error)}</Alert>;
  if (!steps.data) return <Loading />;
  const latest = (botId: string) => steps.data.turns.filter((t) => t.botId === botId).at(-1);
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {team.members.map((m) => (
        <MemberLane
          key={m.botId}
          m={m}
          turn={latest(m.botId)}
          tasks={steps.data.tasks.filter((t) => t.botId === m.botId && t.status !== "done")}
        />
      ))}
    </ul>
  );
}

/** The team's one standing conversation: it opens in Rooms, where the person talks to the lead and every member. */
function ChatTab({ team }: { team: Team }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const lead = team.members.find((m) => m.kind === "chief");
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
      <p>
        One conversation for the whole team. {lead ? `${lead.name} leads it` : "Its lead"} and hands
        work to the members; you see each one's progress in Work. Stop in the chat stops all of
        them.
      </p>
      {error && <Alert theme="danger">{error}</Alert>}
      <Button
        size="sm"
        onClick={() =>
          void teamsApi
            .chat(team.id)
            .then((id) => navigate({ to: "/rooms", search: { id } }))
            .catch((e) => setError(errorMessage(e)))
        }
      >
        Open the team chat
      </Button>
    </div>
  );
}

/** A team on one page: its chat, the work of each member, and who is in it. Settings stay on their own page. */
export function TeamPage({
  teamId,
  tab,
  onTab,
}: {
  teamId: string;
  tab: TeamTab;
  onTab: (t: TeamTab) => void;
}) {
  const query = useQuery(teamsQueries.detail(teamId));
  if (query.error) return <Alert theme="danger">{errorMessage(query.error)}</Alert>;
  const team = query.data;
  if (!team) return <Loading />;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl min-w-0 space-y-5 p-4 md:p-8">
        <Link
          to="/teams"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Teams
        </Link>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div className="min-w-0">
            <h1 className="text-2xl text-balance">{team.name}</h1>
            {team.goal && <p className="text-sm text-muted-foreground">{team.goal}</p>}
          </div>
          <Link
            to="/teams/$teamId/settings"
            params={{ teamId: team.id }}
            className="text-sm underline hover:text-foreground"
          >
            Settings
          </Link>
        </header>
        <div role="tablist" aria-label="Team" className="flex gap-1">
          {TEAM_TABS.map((t) => (
            <Button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              size="sm"
              variant={tab === t.id ? "secondary" : "ghost"}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {tab === "chat" && <ChatTab team={team} />}
        {tab === "work" && <WorkTab team={team} />}
        {tab === "members" &&
          (team.members.length ? (
            <div className="space-y-4">
              <ul className="space-y-1 text-sm">
                {team.members.map((m) => (
                  <li key={m.botId} className="flex items-center gap-2">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground">
                      {m.kind === "chief" ? "Lead" : m.role || "Member"}
                    </span>
                  </li>
                ))}
              </ul>
              <TeamPeoplePanel teamId={team.id} />
            </div>
          ) : (
            <Empty>No members yet. Add bots in Settings.</Empty>
          ))}
      </div>
    </div>
  );
}
