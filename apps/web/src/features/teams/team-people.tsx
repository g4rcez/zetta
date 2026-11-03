import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, Select } from "@/components/ui";

import { errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton, list, listItem, Loading, Panel } from "../shared/ui";
import { teamsApi, type TeamCandidate, type TeamPerson } from "./teams-api";

/**
 * The humans of a team. Every person reads all rooms of the team. The owner adds people from the installation's members and
 * removes them. Posting in a room stays with the owner until a later release.
 */
export function TeamPeoplePanel({ teamId }: { teamId: string }) {
  const [people, setPeople] = useState<TeamPerson[]>();
  const [candidates, setCandidates] = useState<TeamCandidate[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([teamsApi.people(teamId), teamsApi.candidates(teamId)]);
    setPeople(p);
    setCandidates(c);
    setPick("");
  }, [teamId]);
  useEffect(() => {
    load().catch((e) => toast.error(errorMessage(e)));
  }, [load]);

  async function change(work: () => Promise<TeamPerson[]>, done: string) {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!people) return <Loading />;
  return (
    <Panel
      title="People"
      count={people.length}
      description="Everyone here can read every room of this team. Only you can post in them for now."
    >
      <ul className={list}>
        {people.map((p) => (
          <li key={p.userId} className={`${listItem} flex items-center justify-between gap-3`}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-medium">{p.name}</span>
              {p.role === "owner" && <Badge tone="warning">Owner</Badge>}
            </span>
            {p.role === "member" && (
              <ConfirmButton
                label="Remove"
                question={`Remove ${p.name}?`}
                confirmLabel="Remove"
                onConfirm={() =>
                  change(() => teamsApi.removePerson(teamId, p.userId), `${p.name} removed.`)
                }
              />
            )}
          </li>
        ))}
      </ul>
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Select
              title="Add a person"
              required={false}
              disabled={busy}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              options={[
                { value: "", label: "Choose a person" },
                ...candidates.map((c) => ({ value: c.userId, label: c.name })),
              ]}
            />
          </div>
          <Button
            type="button"
            disabled={busy || !pick}
            onClick={() =>
              void change(() => teamsApi.addPerson(teamId, pick), "Person added to the team.")
            }
          >
            Add
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Every member of this installation is already in the team.
        </p>
      )}
    </Panel>
  );
}
