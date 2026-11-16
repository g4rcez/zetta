import { Link } from "@tanstack/react-router";

import { BotIdentity } from "@/components/bot-identity";
import { Checkbox } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import type { Bot } from "../chat/chat-client";
import type { Candidates } from "./projects-api";

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
const row =
  "flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 has-[:checked]:border-primary has-[:checked]:bg-primary/[0.06]";

/**
 * Who works on a project, picked by face: the owner's bots and the people of their teams. A bot gets the brief and the project memory;
 * a person can be asked for things and reads the project page.
 */
export function MemberPicker({
  candidates,
  identities,
  bots,
  people,
  onBots,
  onPeople,
}: {
  candidates: Candidates;
  /** The full bot rows, for the avatars. */
  identities: ReadonlyMap<string, Bot>;
  bots: string[];
  people: string[];
  onBots: (ids: string[]) => void;
  onPeople: (ids: string[]) => void;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1 text-sm font-medium">Bots</legend>
        {candidates.bots.length ? (
          <ul className="grid gap-1.5">
            {candidates.bots.map((b) => (
              <li key={b.id}>
                <label className={row}>
                  <Checkbox
                    checked={bots.includes(b.id)}
                    onChange={() => onBots(toggle(bots, b.id))}
                  />
                  <BotIdentity bot={identities.get(b.id) ?? b} size={24} />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">You have no bots yet.</p>
        )}
      </fieldset>
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1 text-sm font-medium">People</legend>
        {candidates.people.length ? (
          <ul className="grid gap-1.5">
            {candidates.people.map((p) => (
              <li key={p.userId}>
                <label className={row}>
                  <Checkbox
                    checked={people.includes(p.userId)}
                    onChange={() => onPeople(toggle(people, p.userId))}
                  />
                  <UserAvatar name={p.name} size={24} />
                  <span className="truncate text-sm font-medium">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-pretty text-muted-foreground">
            Nobody is in your teams yet. Add a person to a team in{" "}
            <Link to="/teams" className="underline underline-offset-2 hover:text-foreground">
              Teams
            </Link>{" "}
            and they show up here.
          </p>
        )}
      </fieldset>
    </div>
  );
}
