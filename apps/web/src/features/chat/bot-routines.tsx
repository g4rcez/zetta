import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { call, type Bot } from "./chat-client";
import { Empty, Loading } from "../shared/ui";

type Row = { id: string; title: string; botId: string; paused: boolean; status?: string };

/** The routines this bot runs, each linking to its page; new ones are made on the Routines page or asked of the bot in words. */
export function BotRoutines({ bot }: { bot: Bot }) {
  const q = useQuery({
    queryKey: ["routines", { state: "all" }],
    queryFn: () => call<{ routines: Row[] }>("/api/routines").then((r) => r.routines),
  });
  if (!q.data) return <Loading />;
  const mine = q.data.filter((r) => r.botId === bot.id);
  return (
    <div className="space-y-3 text-sm">
      {mine.length ? (
        <ul className="divide-y rounded-md border">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <Link to="/routines/$routineId" params={{ routineId: r.id }} className="underline">
                {r.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {r.paused ? "paused" : (r.status ?? "scheduled")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          No routines yet. Ask {bot.name} in the chat ("every weekday at 9, ...") or add one on the
          Routines page.
        </Empty>
      )}
      <Link to="/routines" className="text-xs underline">
        Open Routines
      </Link>
    </div>
  );
}
