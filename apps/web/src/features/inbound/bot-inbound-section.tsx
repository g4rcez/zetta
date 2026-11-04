import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Checkbox, Input } from "@/components/ui";

import { errorMessage, type Bot } from "../chat/chat-client";
import { inboundApi, inboundQueries } from "./inbound-api";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatTime, type TimeFormat } from "@/features/preferences/time-format";

const when = (iso: string | null, f: TimeFormat) =>
  iso ? formatTime(iso, f, { hour: "numeric", minute: "2-digit" }) : "never";

/**
 * Incoming messages: this bot answers new messages that outside people send through a channel plugin (WhatsApp, Telegram...). Each
 * chat gets its own conversation; the bot can only read, reply to that chat, hand off to you or open a room with pre-approved bots.
 */
export function BotInboundSection({ bot }: { bot: Bot }) {
  const tf = useTimeFormat();
  const qc = useQueryClient();
  const { data: options, error } = useQuery(inboundQueries.forBot(bot.id));
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    if (error) setStatus(errorMessage(error));
  }, [error]);
  const load = () => qc.invalidateQueries({ queryKey: inboundQueries.forBot(bot.id).queryKey });
  async function run(id: string, work: () => Promise<unknown>, done: string) {
    setBusy(id);
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
      await load();
    } catch (e) {
      setStatus(errorMessage(e));
    }
    setBusy(undefined);
  }
  if (!bot.canEdit)
    return (
      <p className="text-xs text-muted-foreground">
        Only the owner can let a bot answer incoming messages.
      </p>
    );
  return (
    <section aria-label="Incoming messages" className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {bot.name} can answer new messages people send you. It reads them as untrusted text, runs
        without code access, and can only reply to the chat the message came from, hand off to you,
        or open a room with the bots you allowed under Rooms.
      </p>
      {!options ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading…
        </p>
      ) : options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Install a messaging plugin (WhatsApp or Telegram) in Studio &gt; Plugins first.
        </p>
      ) : (
        options.map((o) => {
          const mine = o.route?.botId === bot.id,
            on = mine && o.route!.enabled,
            filter = o.route?.filter ?? { direct: true, groups: false, chats: [] };
          return (
            <div key={o.pluginId} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox
                  checked={on}
                  disabled={busy === o.pluginId || !o.bound}
                  onChange={(e) =>
                    void run(
                      o.pluginId,
                      () =>
                        inboundApi.set(bot.id, o.pluginId, { enabled: e.target.checked, filter }),
                      e.target.checked
                        ? `${bot.name} now answers ${o.label} messages.`
                        : `${o.label} messages are no longer answered.`,
                    )
                  }
                >
                  Answer new {o.label} messages
                </Checkbox>
                {on && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === o.pluginId}
                    onClick={() =>
                      void run(
                        o.pluginId,
                        () => inboundApi.pollNow(o.route!.id),
                        "Checked for new messages.",
                      )
                    }
                  >
                    Check now
                  </Button>
                )}
              </div>
              {!o.bound && (
                <p className="text-xs text-muted-foreground">
                  Connect {o.name} to {bot.name} first (Studio &gt; Plugins &gt; {o.name} &gt;
                  Bots).
                </p>
              )}
              {o.route && !mine && o.route.enabled && (
                <p className="text-xs text-warn">
                  {o.route.botName} answers {o.label} now; turning this on moves it to {bot.name}.
                </p>
              )}
              {on && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(
                      o.pluginId,
                      () =>
                        inboundApi.set(bot.id, o.pluginId, {
                          enabled: true,
                          filter: {
                            direct: f.get("direct") === "on",
                            groups: f.get("groups") === "on",
                            chats: String(f.get("chats") ?? "")
                              .split(/[\s,;]+/)
                              .filter(Boolean),
                          },
                        }),
                      "Saved.",
                    );
                  }}
                >
                  <div className="flex flex-wrap gap-4">
                    <Checkbox name="direct" defaultChecked={filter.direct}>
                      Direct chats
                    </Checkbox>
                    <Checkbox name="groups" defaultChecked={filter.groups}>
                      Groups
                    </Checkbox>
                  </div>
                  <Input
                    title="Only these chats (optional)"
                    name="chats"
                    required={false}
                    defaultValue={filter.chats.join(", ")}
                    placeholder="Phone numbers or chat ids, comma separated"
                  />
                  <Button size="sm" type="submit" disabled={busy === o.pluginId}>
                    Save
                  </Button>
                </form>
              )}
              {mine && (
                <p className="text-xs text-muted-foreground">
                  Last checked: {when(o.route!.lastPolledAt, tf)}
                  {o.route!.lastError ? (
                    <span className="text-destructive"> · {o.route!.lastError}</span>
                  ) : null}
                </p>
              )}
              {on && (
                <p className="text-xs text-muted-foreground">
                  To let {bot.name} reply, turn on sending in the {o.name} plugin settings.
                </p>
              )}
            </div>
          );
        })
      )}
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
    </section>
  );
}
