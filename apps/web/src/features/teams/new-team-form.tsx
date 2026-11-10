import { useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { BOT_SIZE, TEAM_DEFAULT_SIZE } from "./team-graph";
import { teamsApi, type Team, type TeamBox } from "./teams-api";

type Pick = { id: string; name: string };

/** Where the members sit inside the new team's box: rows of two, below the team's title. */
export function memberPoints(box: TeamBox, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    x: box.x + 16 + (i % 2) * (BOT_SIZE.w + 12),
    y: box.y + 48 + Math.floor(i / 2) * (BOT_SIZE.h + 12),
  }));
}

/** The box of the next team on the canvas, grown to fit its members. */
export function nextBox(existing: number, members: number): TeamBox {
  const rows = Math.ceil(members / 2);
  return {
    x: 40 + (existing % 2) * (TEAM_DEFAULT_SIZE.w + 40),
    y: 40 + Math.floor(existing / 2) * (TEAM_DEFAULT_SIZE.h + 40),
    w: TEAM_DEFAULT_SIZE.w,
    h: Math.max(TEAM_DEFAULT_SIZE.h, 64 + rows * (BOT_SIZE.h + 12)),
  };
}

/**
 * A team in one step: its name, the bots in it and which one leads. Without bots it is an empty box, as before. The lead must be one of
 * the bots picked; with bots and no lead chosen, the first one leads.
 */
export function NewTeamForm({
  bots,
  existing,
  onCreated,
  onCancel,
}: {
  bots: Pick[];
  /** Teams already on the canvas, to place the new box beside them. */
  existing: number;
  onCreated: (team: Team) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const picked = f.getAll("bots").map(String);
    const lead = String(f.get("lead") ?? "") || picked[0];
    if (!name) return setError("Give the team a name.");
    if (lead && picked.length && !picked.includes(lead))
      return setError("The lead must be one of the bots in the team.");
    setBusy(true);
    setError(undefined);
    try {
      const box = nextBox(existing, picked.length);
      let team = await teamsApi.create(name, box);
      if (picked.length) {
        const points = memberPoints(box, picked.length);
        team = await teamsApi.save(team.id, {
          expectedVersion: team.version,
          name: team.name,
          goal: team.goal,
          canvas: box,
          members: picked.map((botId, i) => ({
            botId,
            kind: botId === lead ? "chief" : "member",
            roleId: null,
            canvas: points[i]!,
          })),
        });
      }
      onCreated(team);
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="New team"
      onSubmit={(e) => void submit(e)}
      className="space-y-3 border-b bg-card p-4 text-sm"
    >
      <Input name="name" title="Team name" placeholder="Launch team" required={false} />
      {bots.length ? (
        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">Bots in the team, and who leads</legend>
          <ul className="grid gap-1 sm:grid-cols-2">
            {bots.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
              >
                <label className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" name="bots" value={b.id} />
                  <span className="truncate">{b.name}</span>
                </label>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="radio" name="lead" value={b.id} />
                  Lead
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="text-muted-foreground">No ready bots yet: the team starts empty.</p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          Create team
        </Button>
      </div>
    </form>
  );
}
