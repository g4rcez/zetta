import { Alert } from "@g4rcez/components/alert";
import { ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { BotIdentity, useBotIdentity } from "@/components/bot-identity";
import { Button } from "@/components/ui";
import { inboundApi } from "../inbound/inbound-api";
import { PluginIcon } from "../plugins/plugin-icon";
import { pluginsApiFor } from "../plugins/plugins-api";
import { errorMessage } from "./chat-client";
import { applyPlan, reachLabel, type InboundCardData } from "./inbound-card-data";

type Phase = "ready" | "busy" | "applied" | "dismissed";

/**
 * A change a bot suggested for a channel plugin (its settings and whether a bot answers incoming messages). The server built this card
 * from a checked proposal: it shows the exact change, and nothing is saved until the person presses Apply. Apply uses their own session
 * through the same settings and incoming-message APIs as Studio.
 */
export function InboundCard({ data }: { data: InboundCardData }) {
  const bot = useBotIdentity(data.botId, data.botName);
  const plan = useMemo(() => applyPlan(data), [data]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string>();

  // A route change that is already in place (the page was reloaded after Apply) shows as applied. Saved plugin settings are never
  // readable in the browser, so a card with settings stays applicable: saving the same value again changes nothing.
  useEffect(() => {
    const want = data.incoming;
    if (!want || data.settings.length) return;
    let live = true;
    void inboundApi.forBot(data.botId).then(
      (options) => {
        const r = options.find((o) => o.pluginId === data.plugin)?.route;
        const same =
          want.state === "on"
            ? r?.enabled === true &&
              r.botId === data.botId &&
              JSON.stringify(r.filter) === JSON.stringify(want.filter)
            : !r?.enabled || r.botId !== data.botId;
        if (live && same) setPhase("applied");
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data]);

  async function apply() {
    setPhase("busy");
    setError(undefined);
    try {
      if (Object.keys(plan.settings).length)
        await pluginsApiFor("mine").configure(data.plugin, plan.settings);
      if (plan.route) await inboundApi.set(data.botId, data.plugin, plan.route);
      setPhase("applied");
    } catch (e) {
      setError(errorMessage(e));
      setPhase("ready");
    }
  }

  if (phase === "dismissed") return null;
  return (
    <section
      aria-label={`Suggested change to ${data.pluginName}`}
      className="my-1 space-y-3 rounded-lg border bg-card p-3 text-sm"
    >
      <header className="flex items-center gap-2">
        <PluginIcon id={data.plugin} name="plug" className="size-7 shrink-0" />
        <h3 className="min-w-0 flex-1 font-medium">Change to {data.pluginName}</h3>
        <BotIdentity bot={bot} size={20} sub="suggests it" className="w-auto flex-none" />
      </header>
      <ul className="space-y-2">
        {data.settings.map((s) => (
          <li key={s.key} className="space-y-0.5">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
                {s.from || "empty"}
              </code>
              <ArrowRightIcon aria-hidden className="size-3.5 shrink-0" />
              <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{s.to}</code>
            </span>
            {s.key === "hookUrl" && (
              <span className="block text-xs text-muted-foreground">
                Your {data.pluginName} server sends the text of each new message to this address.
                Apply it only if it is your own Zetta.
              </span>
            )}
          </li>
        ))}
        {data.incoming && (
          <li className="space-y-0.5">
            <span className="text-xs text-muted-foreground">Incoming messages</span>
            <span className="block">
              {data.incoming.state === "on"
                ? `${data.botName} answers new ${data.pluginName} messages from ${reachLabel(data.incoming.filter)}.`
                : `${data.botName} stops answering new ${data.pluginName} messages.`}
            </span>
            {data.incoming.replaces && (
              <span className="block text-xs text-muted-foreground">
                This replaces {data.incoming.replaces}, which answers them now.
              </span>
            )}
          </li>
        )}
      </ul>
      {error && <Alert theme="danger">{error}</Alert>}
      {phase === "applied" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircleIcon aria-hidden weight="fill" className="size-4 text-success" />
          Applied. Tell {data.botName} to carry on.
        </p>
      ) : (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPhase("dismissed")}
            disabled={phase === "busy"}
          >
            Not now
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void apply()}
            loading={phase === "busy"}
            disabled={phase === "busy"}
          >
            Apply
          </Button>
        </div>
      )}
    </section>
  );
}
