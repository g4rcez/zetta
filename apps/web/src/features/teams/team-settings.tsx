import { ArrowLeftIcon, CrownIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { errorMessage } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { useSidebarData } from "../chat/sidebar-data";
import { Badge, Empty, list, listItem, Loading, Panel } from "../shared/ui";
import { InvitationManager } from "../identity/invitation-manager";
import { DeleteTeamPanel, TeamRoomPanel } from "./team-actions";
import { TeamPeoplePanel } from "./team-people";
import { RoleField, useTeamRoles } from "./team-roles";
import {
  TEAM_SIZE_WARNING,
  TEAM_SIZE_WARNING_AT,
  teamsApi,
  teamsQueries,
  type Team,
  type TeamMember,
} from "./teams-api";

const backClass =
  "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground";

/** Back to the team's room when the page was opened from one, otherwise to the Teams canvas. */
function BackLink({ roomId }: { roomId?: string | undefined }) {
  return roomId ? (
    <Link to="/rooms" search={{ id: roomId }} className={backClass}>
      <ArrowLeftIcon aria-hidden className="size-4" /> Back to room
    </Link>
  ) : (
    <Link to="/teams" className={backClass}>
      <ArrowLeftIcon aria-hidden className="size-4" /> Back to teams
    </Link>
  );
}

/**
 * Settings of one team, opened from the room header or the Teams canvas. Adding or removing bots stays on the canvas.
 * A team has many rooms, so a room's title, goal and context are edited in the room itself; `roomId` only gives the way back.
 */
export function TeamSettingsPage({
  teamId,
  roomId,
  isAdmin,
}: {
  teamId: string;
  roomId?: string | undefined;
  /** Only the installation administrator can issue invitations. */
  isAdmin: boolean;
}) {
  const { reloadRooms, reloadTeams, bots } = useSidebarData();
  const [team, setTeam] = useState<Team>();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [context, setContext] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const { roles } = useTeamRoles();
  const qc = useQueryClient();
  const query = useQuery(teamsQueries.detail(teamId));
  const loadError = query.error && !team ? errorMessage(query.error) : undefined;
  const dirtyRef = useRef(false);
  const fill = (t: Team) => {
    setTeam(t);
    setName(t.name);
    setGoal(t.goal);
    setContext(t.context);
    setMembers(t.members);
  };
  const loaded = query.data;
  useEffect(() => {
    // A newer answer never overwrites what the user is typing.
    if (loaded && (team?.id !== loaded.id || !dirtyRef.current)) fill(loaded);
    // `fill` and `team` change on every fill; only a new answer matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const patchMember = (botId: string, p: Partial<TeamMember>) =>
    setMembers((ms) => ms.map((m) => (m.botId === botId ? { ...m, ...p } : m)));
  const makeChief = (botId: string) =>
    setMembers((ms) =>
      ms.map((m) => ({
        ...m,
        kind: m.botId === botId ? ("chief" as const) : ("member" as const),
      })),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    setError(undefined);
    setSaving(true);
    try {
      const saved = await teamsApi.save(team.id, {
        expectedVersion: team.version,
        name: name.trim(),
        goal: goal.trim(),
        context,
        canvas: team.canvas,
        members: members.map(({ botId, kind, roleId, canvas }) => ({
          botId,
          kind,
          roleId,
          canvas,
        })),
      });
      fill(saved);
      qc.setQueryData(teamsQueries.detail(teamId).queryKey, saved);
      toast.success("Team saved.");
      void reloadRooms();
      void reloadTeams();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loadError)
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
        <BackLink roomId={roomId} />
        <Empty>{loadError}</Empty>
      </div>
    );
  if (!team)
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <Loading />
      </div>
    );

  const dirty =
    name.trim() !== team.name ||
    goal.trim() !== team.goal ||
    context !== team.context ||
    JSON.stringify(members.map((m) => [m.botId, m.kind, m.roleId])) !==
      JSON.stringify(team.members.map((m) => [m.botId, m.kind, m.roleId]));
  dirtyRef.current = dirty;
  const chief = members.find((m) => m.kind === "chief");
  return (
    <div className="h-full overflow-y-auto">
      <form onSubmit={(e) => void submit(e)} className="mx-auto flex min-h-full max-w-3xl flex-col">
        <div className="flex-1 space-y-6 p-4 md:p-8">
          <header className="space-y-3 border-b pb-5">
            <BackLink roomId={roomId} />
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
              >
                <UsersThreeIcon className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl text-balance">{team.name} settings</h1>
                <p className="text-sm text-pretty text-muted-foreground">
                  {members.length} {members.length === 1 ? "bot" : "bots"}
                  {chief ? ` · led by ${chief.name}` : ""}
                </p>
              </div>
            </div>
          </header>
          <Panel
            title="General"
            description="Optional goal. Without one, the chief follows each prompt."
          >
            <div className="space-y-4">
              <Input
                title="Name"
                reportStatus={false}
                maxLength={80}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <MentionTextarea
                title="Goal"
                reportStatus={false}
                required={false}
                rows={4}
                maxLength={1000}
                bots={bots}
                value={goal}
                onChange={setGoal}
              />
            </div>
          </Panel>
          <Panel
            title="Team context"
            description="What every bot reads in every room of this team, before the room's own context."
          >
            <MentionTextarea
              title="Team context"
              hiddenLabel
              reportStatus={false}
              required={false}
              rows={8}
              maxLength={8000}
              bots={bots}
              value={context}
              onChange={setContext}
            />
          </Panel>
          <Panel
            title="Members"
            count={members.length}
            description="Pick the chief and the role of each bot here."
            action={
              <Link to="/teams" className="text-sm underline underline-offset-2">
                Add or remove bots on the canvas
              </Link>
            }
          >
            {members.length > TEAM_SIZE_WARNING_AT && (
              <p
                role="status"
                className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm"
              >
                {TEAM_SIZE_WARNING}
              </p>
            )}
            <ul className={list}>
              {members.map((m) => (
                <li
                  key={m.botId}
                  className={`${listItem} grid items-start gap-3 md:grid-cols-[11rem_minmax(0,1fr)_auto]`}
                >
                  <div className="flex min-w-0 items-center gap-2 md:pt-6">
                    <span className="min-w-0 truncate font-medium">{m.name}</span>
                    {m.kind === "chief" && (
                      <Badge tone="warning">
                        <CrownIcon className="mr-1 size-3" aria-hidden="true" />
                        Chief
                      </Badge>
                    )}
                  </div>
                  <RoleField
                    roles={roles}
                    value={m.roleId}
                    onChange={(roleId) => patchMember(m.botId, { roleId })}
                  />
                  <div className="md:pt-6">
                    {m.kind === "chief" ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Make ${m.name} the chief`}
                        onClick={() => makeChief(m.botId)}
                      >
                        Make chief
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <TeamPeoplePanel teamId={team.id} />
        </div>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:px-8">
          {error && (
            <p role="alert" className="mr-auto text-sm text-destructive">
              {error}
            </p>
          )}
          {!error && dirty && (
            <p role="status" className="mr-auto text-sm text-muted-foreground">
              Unsaved changes
            </p>
          )}
          <Button type="submit" disabled={saving || !dirty || !name.trim()}>
            Save
          </Button>
        </div>
      </form>
      {/* Outside the team form: a form cannot contain another form, and Enter in a room title must not save the team. */}
      <div className="mx-auto max-w-3xl space-y-6 px-4 pb-8 md:px-8">
        <TeamRoomPanel team={team} unsaved={dirty} />
        {isAdmin && (
          <div>
            <InvitationManager />
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Once the person has an account, add them to this team in People above.
            </p>
          </div>
        )}
        <DeleteTeamPanel team={team} />
      </div>
    </div>
  );
}
