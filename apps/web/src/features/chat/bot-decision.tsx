import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { MentionTextarea } from "./mention";
import { LayaOffNote } from "../studio/laya-switch";

import {
  ApiError,
  chatClient,
  errorMessage,
  type Bot,
  type DecisionConfig,
  type DecisionOption,
  type Route,
} from "./chat-client";
import { chatQueries } from "./chat-queries";

const ACTIONS: Record<DecisionOption["action"], string> = {
  respond: "Answer normally",
  ask_user: "Ask me a question",
  delegate: "Hand to another bot",
  stop: "Stop and reply",
};
const blank: DecisionConfig = {
  enabled: false,
  question: "What does this message need?",
  minConfidencePct: 60,
  options: [
    { label: "Normal request", description: "A regular question or task", action: "respond" },
    {
      label: "Off limits",
      description: "Something this bot should not handle",
      action: "stop",
      reply: "I can't help with that.",
    },
  ],
};

export function describeRoute(r: Route, bots: Bot[]): string {
  if (r.action === "respond")
    return r.reason === "unavailable"
      ? "The decision model is still loading. Try again in a moment."
      : r.reason === "uncertain"
        ? `Not sure enough${r.confidence !== undefined ? ` (${Math.round(r.confidence * 100)}%)` : ""}, so the bot would answer normally.`
        : r.reason === "disabled"
          ? "Routing is off, so the bot would answer normally."
          : `Chosen: "${r.choice}". The bot answers normally.`;
  if (r.action === "delegate")
    return `Chosen: "${r.choice}". It would be handed to ${bots.find((b) => b.id === r.targetBotId)?.name ?? "another bot"}.`;
  return `Chosen: "${r.choice}". ${r.action === "stop" ? "The chat would stop with" : "The bot would ask"}: ${r.reply}`;
}

/** Decision routing (Laya) for a bot the user owns. */
export function BotDecision({ bot, bots }: { bot: Bot; bots: Bot[] }) {
  const { data, error } = useQuery(chatQueries.decisionConfig(bot.id));
  if (data === undefined)
    return (
      <section aria-label="Decision routing" className="rounded-lg border bg-card p-4">
        <h3 className="text-base font-semibold tracking-tight">Decision routing</h3>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage(error)}
          </p>
        ) : (
          <p className="text-xs">Loading…</p>
        )}
      </section>
    );
  // The form keeps its own draft: a refetch must never replace what the person is typing.
  return <DecisionForm key={bot.id} bot={bot} bots={bots} initial={data ?? blank} />;
}

function DecisionForm({ bot, bots, initial }: { bot: Bot; bots: Bot[]; initial: DecisionConfig }) {
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<DecisionConfig>(initial);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [text, setText] = useState("");
  const [route, setRoute] = useState<Route>();
  const setOpt = (i: number, p: Partial<DecisionOption>) =>
    setCfg({ ...cfg, options: cfg.options.map((o, k) => (k === i ? { ...o, ...p } : o)) });
  const others = bots.filter((b) => b.id !== bot.id);
  // A decision-only bot (harness "decision") has no AI: its model picks an option and the option's reply is the whole answer.
  const only = bot.harness === "decision";
  const engine = only ? (bot.model === "jev" ? "jev" : "laya") : (cfg.backend ?? "laya");
  const labels = cfg.options.map((o) => o.label.trim());
  const problem =
    cfg.options.length < 2
      ? "Add at least two options."
      : labels.some((l) => !l) || cfg.options.some((o) => !o.description.trim())
        ? "Every option needs a name and a description."
        : new Set(labels).size !== labels.length
          ? "Option names must be different."
          : cfg.options.some((o) => o.action === "delegate" && !o.targetBotId)
            ? "Choose which bot to hand over to."
            : only && cfg.options.some((o) => o.action !== "delegate" && !o.reply?.trim())
              ? "Every option needs a reply, because this bot has no AI to write one."
              : undefined;
  async function save() {
    setError(undefined);
    setStatus(undefined);
    const clean: DecisionConfig = {
      ...cfg,
      enabled: only || cfg.enabled,
      backend: engine,
      options: cfg.options.map((o) => ({
        label: o.label.trim(),
        description: o.description.trim(),
        action: o.action,
        ...(o.action === "delegate" ? { targetBotId: o.targetBotId } : {}),
        ...(o.action === "ask_user" || o.action === "stop" || (only && o.action === "respond")
          ? { reply: o.reply ?? "" }
          : {}),
      })),
    };
    try {
      const saved = await chatClient.saveDecisionConfig(bot.id, clean);
      setCfg(saved);
      qc.setQueryData(chatQueries.decisionConfig(bot.id).queryKey, saved);
      setStatus("Routing saved.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function preview() {
    setError(undefined);
    setRoute(undefined);
    try {
      setRoute(await chatClient.previewDecision(bot.id, text));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 503
          ? "The decision model is still loading. Try again in a moment."
          : errorMessage(e),
      );
    }
  }
  return (
    <section aria-label="Decision routing" className="space-y-4 rounded-xl border bg-card p-5">
      <h3 className="font-medium">Decision routing</h3>
      <p className="text-xs text-muted-foreground">
        {only
          ? `This bot has no AI. ${engine === "jev" ? "Jev" : "Laya"} sorts each message into one of your options and the bot sends that option's reply. Change the model in the bot's general settings.`
          : "Before answering, the built-in decision model (Laya) can sort each message into one of your options and act on it."}
      </p>
      {engine === "laya" && <LayaOffNote />}
      {!only && (
        <>
          <Checkbox
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          >
            Use routing for this bot
          </Checkbox>
          <Select
            title="Decision engine"
            container="ml-2 rounded-md border bg-muted/40 px-1"
            required={false}
            value={cfg.backend ?? "laya"}
            onChange={(e) => setCfg({ ...cfg, backend: e.target.value as "laya" | "jev" })}
            options={[
              { value: "laya", label: "Laya (built in, free, private)" },
              { value: "jev", label: "Jev (Typesafe, hosted) - not verified yet" },
            ]}
          />
        </>
      )}
      {engine === "jev" && (
        <p className="text-xs text-muted-foreground">
          Jev sends the message text to Typesafe and needs your own Jev key under Studio &gt;
          Accounts. It has not been verified against the real service.
        </p>
      )}
      <Input
        title="Question to decide"
        value={cfg.question}
        maxLength={300}
        onChange={(e) => setCfg({ ...cfg, question: e.target.value })}
      />
      <Input
        title="Only act when at least this sure (%)"
        container="w-24"
        type="number"
        min={0}
        max={100}
        value={cfg.minConfidencePct}
        onChange={(e) =>
          setCfg({
            ...cfg,
            minConfidencePct: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))),
          })
        }
      />
      <ol className="space-y-2">
        {cfg.options.map((o, i) => (
          <li key={i} className="space-y-1 rounded-md border bg-card p-3">
            <div className="grid gap-1 sm:grid-cols-2">
              <Input
                title={`Option ${i + 1} name`}
                value={o.label}
                maxLength={60}
                onChange={(e) => setOpt(i, { label: e.target.value })}
              />
              <Select
                title="Then"
                required={false}
                value={o.action}
                onChange={(e) => setOpt(i, { action: e.target.value as DecisionOption["action"] })}
                options={(Object.keys(ACTIONS) as DecisionOption["action"][]).map((a) => ({
                  value: a,
                  label: ACTIONS[a],
                }))}
              />
            </div>
            <Input
              title="When the message is like this"
              value={o.description}
              maxLength={200}
              onChange={(e) => setOpt(i, { description: e.target.value })}
            />
            {o.action === "delegate" && (
              <Select
                title="Hand over to"
                required={false}
                value={o.targetBotId ?? ""}
                onChange={(e) => setOpt(i, { targetBotId: e.target.value || undefined })}
                placeholder="Choose a bot…"
                options={others.map((b) => ({ value: b.id, label: b.name }))}
              />
            )}
            {(o.action === "ask_user" ||
              o.action === "stop" ||
              (only && o.action === "respond")) && (
              <Input
                title="Reply"
                value={o.reply ?? ""}
                maxLength={1000}
                onChange={(e) => setOpt(i, { reply: e.target.value })}
              />
            )}
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={cfg.options.length <= 2}
              onClick={() => setCfg({ ...cfg, options: cfg.options.filter((_, k) => k !== i) })}
            >
              Remove option {i + 1}
            </Button>
          </li>
        ))}
      </ol>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={cfg.options.length >= 8}
          onClick={() =>
            setCfg({
              ...cfg,
              options: [...cfg.options, { label: "", description: "", action: "respond" }],
            })
          }
        >
          Add option
        </Button>
        <Button type="button" size="sm" disabled={!!problem} onClick={() => void save()}>
          Save routing
        </Button>
      </div>
      <div className="space-y-1 rounded-md border bg-card p-3">
        <MentionTextarea
          title="Preview: type a message to see what routing would do (saved settings are used)"
          className="mt-0.5"
          bots={bots}
          value={text}
          onChange={setText}
          rows={2}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!text.trim()}
          onClick={() => void preview()}
        >
          Preview routing
        </Button>
        {route && (
          <p role="status" className="text-xs">
            {describeRoute(route, bots)}
          </p>
        )}
      </div>
      <p role="status" className="text-xs">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
