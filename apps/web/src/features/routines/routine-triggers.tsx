import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";

import { ENV } from "../../env";
import { call, errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty } from "../shared/ui";

export type TriggerKind = "webhook" | "gmail" | "home_assistant";
type Trigger = {
  id: string;
  kind: TriggerKind;
  filter: { query?: string; entityId?: string; to?: string };
  status: "active" | "paused" | "failing";
  statusReason: string | null;
};
const KIND_LABEL: Record<TriggerKind, string> = {
  webhook: "Webhook",
  gmail: "New Gmail message",
  home_assistant: "Home Assistant change",
};
const STATUS: Record<Trigger["status"], { label: string; tone: "success" | "neutral" | "danger" }> =
  {
    active: { label: "Active", tone: "success" },
    paused: { label: "Paused", tone: "neutral" },
    failing: { label: "Stopped", tone: "danger" },
  };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** What started a run, in a few words. The text of a mail or a state comes from outside: it is shown as plain text and cut short. */
export function runOrigin(r: { trigger: string; event?: unknown }): string {
  const event = (r.event ?? {}) as {
    source?: string;
    subject?: string;
    name?: string;
    entityId?: string;
    to?: string;
  };
  switch (r.trigger) {
    case "manual":
      return "started by you";
    case "recovery":
      return "retried after a failure";
    case "webhook":
      return "started by a webhook";
    case "event":
      return event.source === "gmail"
        ? `new mail: ${clip(String(event.subject ?? "(no subject)"), 80)}`
        : event.source === "home_assistant"
          ? `${clip(String(event.name ?? event.entityId ?? "A device"), 60)} changed to ${clip(String(event.to ?? "?"), 40)}`
          : "started by an event";
    default:
      return "scheduled";
  }
}

const webhookUrl = (id: string) =>
  new URL(`/api/routines/hook/${id}`, ENV.ZETTA_SERVER_URL).toString();
const curlExample = (id: string, secret: string) =>
  `curl -X POST '${webhookUrl(id)}' \\\n  -H 'Authorization: Bearer ${secret}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"hello":"world"}'`;

const describe = (t: Trigger) =>
  t.kind === "webhook"
    ? "A call to its address with the secret"
    : t.kind === "gmail"
      ? `A new mail that matches "${clip(t.filter.query ?? "", 80)}"`
      : `${t.filter.entityId} changes${t.filter.to ? ` to "${t.filter.to}"` : ""}`;

/** Extra ways to start a routine, next to its schedule. A paused routine ignores them. */
export function RoutineTriggers({ routineId, paused }: { routineId: string; paused: boolean }) {
  const qc = useQueryClient();
  const key = ["routines", routineId, "triggers"];
  const base = `/api/routines/${routineId}/triggers`;
  const triggers = useQuery({
    queryKey: key,
    queryFn: () => call<{ triggers: Trigger[] }>(base).then((r) => r.triggers),
  });
  const [adding, setAdding] = useState<TriggerKind>();
  const [query, setQuery] = useState("");
  const [entityId, setEntityId] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A webhook's secret is shown once, when it is made or rotated.
  const [shown, setShown] = useState<{ id: string; secret: string }>();

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function create(e: FormEvent) {
    e.preventDefault();
    if (!adding) return;
    const body =
      adding === "webhook"
        ? { kind: adding }
        : adding === "gmail"
          ? { kind: adding, query: query.trim() }
          : { kind: adding, entityId: entityId.trim(), ...(to.trim() ? { to: to.trim() } : {}) };
    void run(async () => {
      const made = await call<{ trigger: Trigger; secret?: string }>(base, "POST", body);
      if (made.secret) setShown({ id: made.trigger.id, secret: made.secret });
      setAdding(undefined);
      setQuery("");
      setEntityId("");
      setTo("");
    });
  }
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <section aria-label="Triggers" className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        A trigger starts this routine when something happens, on top of its schedule.{" "}
        {paused
          ? "This routine is paused, so its triggers do nothing until you activate it."
          : "What a trigger brings in (a mail, a call, a state) is outside data: the bot reads it, and anything it wants to change waits for your approval."}
      </p>
      {triggers.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(triggers.error)}
        </p>
      )}
      {triggers.isSuccess && triggers.data.length === 0 && <Empty>No triggers yet.</Empty>}
      <ul className="space-y-2">
        {triggers.data?.map((t) => (
          <li key={t.id} className="min-w-0 space-y-2 rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="font-medium">{KIND_LABEL[t.kind]}</strong>
              <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
              <span className="min-w-0 break-words text-xs text-muted-foreground">
                {describe(t)}
              </span>
            </div>
            {t.statusReason && (
              <p role="status" className="text-xs text-muted-foreground">
                {t.statusReason}
              </p>
            )}
            {t.kind === "webhook" && (
              <p className="break-all text-xs text-muted-foreground">
                Address: <code>{webhookUrl(t.id)}</code>
              </p>
            )}
            {shown?.id === t.id && (
              <div className="space-y-1 rounded-md border border-warn/40 bg-warn/5 p-2 text-xs">
                <p>Copy the secret now. It is not shown again.</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                  {curlExample(t.id, shown.secret)}
                </pre>
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" onClick={() => copy(shown.secret)}>
                    Copy secret
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setShown(undefined)}>
                    I copied it
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await call(`${base}/${t.id}`, "PUT", {
                      status: t.status === "active" ? "paused" : "active",
                    });
                  })
                }
              >
                {t.status === "active" ? "Pause" : "Turn on"}
              </Button>
              {t.kind === "webhook" && (
                <ConfirmButton
                  label="New secret"
                  question="Make a new secret? The old one stops working now."
                  confirmLabel="Make new secret"
                  size="xs"
                  onConfirm={() =>
                    run(async () => {
                      const r = await call<{ secret: string }>(`${base}/${t.id}/rotate`, "POST");
                      setShown({ id: t.id, secret: r.secret });
                    })
                  }
                />
              )}
              <ConfirmButton
                label="Delete"
                question="Delete this trigger?"
                confirmLabel="Delete"
                size="xs"
                onConfirm={() =>
                  run(async () => {
                    await call(`${base}/${t.id}`, "DELETE");
                  })
                }
              />
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div role="group" aria-label="Add a trigger" className="flex flex-wrap gap-1">
        {(["webhook", "gmail", "home_assistant"] as const).map((k) => (
          <Button
            key={k}
            size="xs"
            variant={adding === k ? "secondary" : "outline"}
            aria-pressed={adding === k}
            onClick={() => setAdding(adding === k ? undefined : k)}
          >
            Add: {KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      {adding && (
        <form onSubmit={create} className="space-y-2">
          {adding === "gmail" && (
            <Input
              title="Gmail search (as in Gmail)"
              placeholder="from:billing@example.com"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              required
              maxLength={200}
            />
          )}
          {adding === "home_assistant" && (
            <>
              <Input
                title="Entity"
                placeholder="light.kitchen"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                required
                maxLength={129}
              />
              <Input
                title="Only when it changes to (optional)"
                placeholder="on"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                maxLength={50}
              />
            </>
          )}
          {adding === "webhook" && (
            <p className="text-xs text-muted-foreground">
              You get an address and a secret. Anything that can send an HTTP POST can start the
              routine: curl, a cron job, n8n.
            </p>
          )}
          <Button size="sm" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add trigger"}
          </Button>
        </form>
      )}
    </section>
  );
}
