import { useEffect, useState } from "react";

import { Checkbox } from "@/components/ui";

import { errorMessage, type Bot } from "../chat/chat-client";
import { discussionsApi } from "./discussions-api";

/** Which bots this bot may open a group discussion with right away (for you only). Others need your approval each time. */
export function BotPeersSection({ bot, bots }: { bot: Bot; bots: Bot[] }) {
  const [peers, setPeers] = useState<Set<string>>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    discussionsApi.peers(bot.id).then(
      (p) => setPeers(new Set(p.map((x) => x.id))),
      (e) => setStatus(errorMessage(e)),
    );
  }, [bot.id]);
  const others = bots.filter((b) => b.id !== bot.id && b.onboarded);
  async function toggle(id: string, on: boolean) {
    if (!peers) return;
    const next = new Set(peers);
    if (on) next.add(id);
    else next.delete(id);
    setBusy(true);
    setStatus(undefined);
    try {
      setPeers(new Set((await discussionsApi.setPeers(bot.id, [...next])).map((x) => x.id)));
      setStatus("Saved.");
    } catch (e) {
      setStatus(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <section aria-label="Rooms" className="space-y-2">
      <p className="text-xs text-muted-foreground">
        When a task needs other bots, {bot.name} can open a room with them and share the task
        context. Bots ticked here join right away; any other bot needs your approval each time. When{" "}
        {bot.name} answers outside people (incoming messages), only ticked bots can be invited.
      </p>
      {!peers ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading…
        </p>
      ) : others.length === 0 ? (
        <p className="text-xs text-muted-foreground">No other ready bots yet.</p>
      ) : (
        <ul className="space-y-1">
          {others.map((b) => (
            <li key={b.id}>
              <Checkbox
                checked={peers.has(b.id)}
                disabled={busy}
                onChange={(e) => void toggle(b.id, e.target.checked)}
              >
                {b.name}
                {b.codeAccess ? " (can change code)" : ""}
              </Checkbox>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
    </section>
  );
}
