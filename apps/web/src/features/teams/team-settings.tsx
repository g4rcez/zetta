import { ArrowLeftIcon, CrownIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";

import { errorMessage } from "../chat/chat-client";
import { useSidebarData } from "../chat/sidebar-data";
import { discussionsApi } from "../discussions/discussions-api";
import { Badge, Empty, list, listItem, Loading, Panel } from "../shared/ui";
import { RoleField, RolesDialog, useTeamRoles } from "./team-roles";
import {
  TEAM_SIZE_WARNING,
  TEAM_SIZE_WARNING_AT,
  teamsApi,
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
 * Settings of one team, opened from the room header like a bot's settings. Adding or removing bots stays on the Teams canvas.
 * The room (whose name must stay unique) is renamed first, so a clash fails before the team changes.
 */
export function TeamSettingsPage({
  teamId,
  roomId,
}: {
  teamId: string;
  roomId?: string | undefined;
}) {
  const { reloadRooms } = useSidebarData();
  const [team, setTeam] = useState<Team>();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const { roles, reload: reloadRoles } = useTeamRoles();
  const [rolesOpen, setRolesOpen] = useState(false);
  const fill = (t: Team) => {
    setTeam(t);
    setName(t.name);
    setGoal(t.goal);
    setMembers(t.members);
  };
  useEffect(() => {
    setLoadError(undefined);
    void teamsApi
      .get(teamId)
      .then(fill)
      .catch((e) => setLoadError(errorMessage(e)));
  }, [teamId]);
  const patchMember = (botId: string, p: Partial<TeamMember>) =>
    setMembers((ms) => ms.map((m) => (m.botId === botId ? { ...m, ...p } : m)));
  const makeChief = (botId: string) =>
    setMembers((ms) =>
      ms.map((m) => ({
        ...m,
        kind: m.botId === botId ? ("chief" as const) : ("member" as const),
      })),
    );
  async function renameRoom(changed: { name?: string; goal?: string }) {
    if (!roomId) return;
    const { discussion } = await discussionsApi.get(roomId);
    await discussionsApi.update(roomId, discussion.version, {
      ...(changed.name !== undefined ? { title: changed.name } : {}),
      ...(changed.goal !== undefined ? { goal: changed.goal } : {}),
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    setError(undefined);
    setSaving(true);
    try {
      const next = { name: name.trim(), goal: goal.trim() };
      const changed = {
        ...(next.name !== team.name ? { name: next.name } : {}),
        ...(next.goal !== team.goal ? { goal: next.goal } : {}),
      };
      if (Object.keys(changed).length) await renameRoom(changed);
      const saved = await teamsApi.save(team.id, {
        expectedVersion: team.version,
        ...next,
        canvas: team.canvas,
        members: members.map(({ botId, kind, roleId, canvas }) => ({
          botId,
          kind,
          roleId,
          canvas,
        })),
      });
      fill(saved);
      toast.success("Team saved.");
      void reloadRooms();
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
    JSON.stringify(members.map((m) => [m.botId, m.kind, m.roleId])) !==
      JSON.stringify(team.members.map((m) => [m.botId, m.kind, m.roleId]));
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
              <Textarea
                title="Goal"
                reportStatus={false}
                required={false}
                rows={4}
                maxLength={1000}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
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
                    onManage={() => setRolesOpen(true)}
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
        </div>
        {rolesOpen && (
          <RolesDialog roles={roles} onChanged={reloadRoles} onClose={() => setRolesOpen(false)} />
        )}
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
    </div>
  );
}
