import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button, Input, Modal } from "@/components/ui";

import { errorMessage } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { useSidebarData } from "../chat/sidebar-data";
import { Panel } from "../shared/ui";
import { teamsApi, teamsQueries, type Team } from "./teams-api";

type Pending = "room" | "chat" | undefined;

/**
 * Opens a room or the team's chat. It sits outside the settings form, so Enter in the room title starts a room and does not save the team.
 * `unsaved` blocks it: the server starts the room with the team it holds, not with the edits on screen.
 */
export function TeamRoomPanel({ team, unsaved }: { team: Team; unsaved: boolean }) {
  const navigate = useNavigate();
  const { bots } = useSidebarData();
  const [title, setTitle] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState<string>();
  const ready = team.members.length >= 2 && !unsaved;

  async function run(kind: Exclude<Pending, undefined>, go: () => Promise<unknown>) {
    setError(undefined);
    setPending(kind);
    try {
      await go();
    } catch (e) {
      setError(errorMessage(e));
      setPending(undefined);
    }
  }
  const startRoom = (event: FormEvent) => {
    event.preventDefault();
    const text = firstMessage.trim();
    void run("room", async () => {
      const id = await teamsApi.startRoom(team.id, {
        title: title.trim(),
        // The text is the goal and the first order, as in the New room page.
        ...(text ? { goal: text, firstMessage: text } : {}),
      });
      await navigate({ to: "/rooms", search: { id, view: "canvas" } });
    });
  };
  const openChat = () =>
    void run("chat", async () => {
      const id = await teamsApi.chat(team.id);
      await navigate({ to: "/rooms", search: { id } });
    });

  return (
    <Panel
      title="Rooms"
      description="Open a room: the chief gets your first order and coordinates the team. The team chat talks to all members and sets goals for them."
    >
      <form onSubmit={startRoom} className="space-y-4">
        <Input
          title="Room title"
          reportStatus={false}
          required={false}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <MentionTextarea
          title="What should the bots do? (optional)"
          reportStatus={false}
          required={false}
          rows={4}
          maxLength={1000}
          bots={bots}
          value={firstMessage}
          onChange={setFirstMessage}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!ready || pending !== undefined || !title.trim()}>
            Start a room
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!ready || pending !== undefined}
            onClick={openChat}
          >
            Chat with team
          </Button>
          {team.members.length < 2 && (
            <p className="text-sm text-muted-foreground">
              Add a chief and at least one more bot on the canvas first.
            </p>
          )}
          {team.members.length >= 2 && unsaved && (
            <p className="text-sm text-muted-foreground">Save the team first.</p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </Panel>
  );
}

/** Archives the team after a confirmation. Rooms already opened stay. */
export function DeleteTeamPanel({ team }: { team: Team }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { reloadTeams } = useSidebarData();
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    const confirmed = await Modal.confirm<boolean>({
      title: `Delete team "${team.name}"?`,
      description: "Rooms already opened stay.",
      confirm: { text: "Delete team", theme: "danger" },
    });
    if (!confirmed) return;
    setError(undefined);
    setDeleting(true);
    try {
      await teamsApi.archive(team.id);
      void qc.invalidateQueries({ queryKey: teamsQueries.list().queryKey });
      void reloadTeams();
      await navigate({ to: "/teams" });
    } catch (e) {
      setError(errorMessage(e));
      setDeleting(false);
    }
  }

  return (
    <Panel title="Delete team" description="Rooms already opened stay.">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="text-destructive"
          disabled={deleting}
          onClick={() => void remove()}
        >
          Delete team
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
