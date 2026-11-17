import { ArrowLeftIcon, HashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Button, Input, Select } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/notify";
import { errorMessage, type Bot } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { useRooms, useSidebarData, useTeams } from "../chat/sidebar-data";
import { Empty, Loading, Panel } from "../shared/ui";
import { discussionsApi, discussionsQueries, type DiscussionDetail } from "./discussions-api";
import { canEditRoom, CONTEXT_LABEL, GOAL_LABEL } from "./room-description";

const backClass =
  "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground";

function BackToRoom({ roomId }: { roomId: string }) {
  return (
    <Link to="/rooms" search={{ id: roomId }} className={backClass}>
      <ArrowLeftIcon aria-hidden="true" className="size-4" /> Back to the room
    </Link>
  );
}

/** The form itself. It starts from the room as loaded and reads the version again at save time, so a change of type does not make it stale. */
function RoomSettingsForm({
  room,
  bots,
  versionOf,
  onSaved,
}: {
  room: DiscussionDetail["discussion"];
  bots: Bot[];
  /** The latest version of the room, which a change of type may have moved. */
  versionOf: () => number;
  onSaved: () => void;
}) {
  const teams = useTeams();
  const [title, setTitle] = useState(room.title);
  const [goal, setGoal] = useState(room.goal);
  const [context, setContext] = useState(room.context);
  const [busy, setBusy] = useState(false);
  const { reload } = useRooms();
  const qc = useQueryClient();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await discussionsApi.update(room.id, versionOf(), {
        title: title.trim(),
        goal: goal.trim(),
        context,
      });
      await Promise.all([
        qc.invalidateQueries({
          queryKey: discussionsQueries.detail(room.id).queryKey,
          exact: true,
        }),
        reload(),
      ]);
      toast.success("Room saved.");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function setTeam(teamId: string) {
    setBusy(true);
    try {
      await discussionsApi.setTeam(room.id, teamId || null);
      await Promise.all([
        qc.invalidateQueries({
          queryKey: discussionsQueries.detail(room.id).queryKey,
          exact: true,
        }),
        reload(),
      ]);
      toast.success("Room type changed.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6">
      <Panel title="About this room" description="What people and bots read first.">
        <div className="space-y-4">
          <Input
            title="Title"
            reportStatus={false}
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <MentionTextarea
            title={GOAL_LABEL}
            reportStatus={false}
            required={false}
            rows={3}
            maxLength={1000}
            bots={bots}
            value={goal}
            onChange={setGoal}
          />
          <MentionTextarea
            title={CONTEXT_LABEL}
            reportStatus={false}
            required={false}
            rows={10}
            maxLength={8000}
            bots={bots}
            value={context}
            onChange={setContext}
          />
          <p className="text-xs text-muted-foreground">
            Both are Markdown: links are clickable in the room details. Changing them asks again
            before a code bot acts on outside content.
          </p>
        </div>
      </Panel>
      {room.kind === "room" && (
        <Panel title="Type" description="A team room is led by the team's chief.">
          <Select
            title="Type"
            hiddenLabel
            required={false}
            disabled={busy}
            value={room.teamId ?? ""}
            onChange={(e) => void setTeam(e.target.value)}
            options={[
              { value: "", label: "Plain room" },
              ...teams.map((t) => ({ value: t.id, label: `Team: ${t.name}` })),
            ]}
          />
        </Panel>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !title.trim()}>
          Save
        </Button>
        <Button variant="ghost" type="button" disabled={busy} onClick={onSaved}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Where a room is edited: its title, what it is for, and the details and references the bots read. The room's own page only shows them.
 * Only the owner changes an open room; a team member who reads it, or anyone once it is closed, gets the reason and the way back.
 */
export function RoomSettingsPage({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { bots } = useSidebarData();
  const query = useQuery(discussionsQueries.detail(roomId));
  const detail = query.data;
  const back = () => void navigate({ to: "/rooms", search: { id: roomId } });
  if (query.error && !detail)
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
        <BackToRoom roomId={roomId} />
        <Empty>{errorMessage(query.error)}</Empty>
      </div>
    );
  if (!detail || !session)
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <Loading />
      </div>
    );
  const room = detail.discussion;
  const owner = detail.owner.userId === session.user.id;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        <header className="space-y-3 border-b pb-5">
          <BackToRoom roomId={roomId} />
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
            >
              <HashIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl text-balance">{room.title} settings</h1>
              <p className="text-sm text-pretty text-muted-foreground">
                Details version {room.contextVersion}
              </p>
            </div>
          </div>
        </header>
        {canEditRoom(room, owner) ? (
          <RoomSettingsForm
            key={room.id}
            room={room}
            bots={bots}
            versionOf={() => query.data?.discussion.version ?? room.version}
            onSaved={back}
          />
        ) : (
          <p role="note" className="text-sm text-muted-foreground">
            {owner
              ? "This room is closed, so its words can no longer be changed."
              : `Only ${detail.owner.name} can change this room.`}
          </p>
        )}
      </div>
    </div>
  );
}
