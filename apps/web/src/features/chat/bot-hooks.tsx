import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { MentionTextarea } from "./mention";
import { useSidebarData } from "./sidebar-data";

import { chatClient, errorMessage, type Bot, type Hook, type HookDryRun } from "./chat-client";
import { chatQueries } from "./chat-queries";

const KIND: Record<Hook["kind"], string> = {
  add_context: "Add context",
  redact: "Hide text",
  stop: "Stop message",
  background: "Background task",
};
const sorted = (l: Hook[]) => [...l].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
const NONE: Hook[] = [];

export function BotHooks({ bot }: { bot: Bot }) {
  const { bots } = useSidebarData();
  const qc = useQueryClient();
  const hooksKey = chatQueries.hooks(bot.id).queryKey;
  const hooks = useQuery({ ...chatQueries.hooks(bot.id), select: sorted }).data ?? NONE;
  const setHooks = (update: (l: Hook[]) => Hook[]) =>
    qc.setQueryData<Hook[]>(hooksKey, (l) => update(l ?? []));
  const [error, setError] = useState<string>();
  const [test, setTest] = useState("");
  const [result, setResult] = useState<HookDryRun>();
  const guard = async (work: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const toggle = (h: Hook) =>
    guard(async () => {
      const next = await chatClient.updateHook(h.id, { enabled: !(h.enabled ?? true) });
      setHooks((l) => l.map((x) => (x.id === h.id ? { ...x, ...next } : x)));
    });
  const move = (i: number, dir: -1 | 1) =>
    guard(async () => {
      const order = [...hooks];
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j]!, order[i]!];
      await Promise.all(
        order.map((h, k) =>
          (h.position ?? 0) === k ? undefined : chatClient.updateHook(h.id, { position: k }),
        ),
      );
      qc.setQueryData<Hook[]>(
        hooksKey,
        order.map((h, k) => ({ ...h, position: k })),
      );
    });
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    return guard(async () => {
      await chatClient.addHook(bot.id, {
        kind: f.get("kind") as Hook["kind"],
        pattern: String(f.get("pattern") ?? ""),
        value: String(f.get("value") ?? ""),
      });
      form.reset();
      await qc.invalidateQueries({ queryKey: hooksKey });
    });
  };
  const dry = (e: FormEvent) => {
    e.preventDefault();
    return guard(async () => setResult(await chatClient.dryRunHooks(bot.id, test)));
  };

  return (
    <section aria-label="Hooks" className="space-y-4 rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold tracking-tight">Hooks</h3>
      <p className="text-xs text-muted-foreground">
        Hooks run on your message before the bot sees it, from top to bottom.
      </p>
      {hooks.length === 0 && <p className="text-xs text-muted-foreground">No hooks yet.</p>}
      <ol className="space-y-1">
        {hooks.map((h, i) => (
          <li
            key={h.id}
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-card p-2"
          >
            <span className="w-5 text-xs text-muted-foreground" aria-label={`Position ${i + 1}`}>
              {i + 1}.
            </span>
            <Checkbox checked={h.enabled ?? true} onChange={() => void toggle(h)}>
              {KIND[h.kind]}
            </Checkbox>
            <span className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
              {h.pattern || h.value.slice(0, 40)}
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={i === 0}
              onClick={() => void move(i, -1)}
              aria-label={`Move ${KIND[h.kind]} hook up`}
            >
              ↑
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={i === hooks.length - 1}
              onClick={() => void move(i, 1)}
              aria-label={`Move ${KIND[h.kind]} hook down`}
            >
              ↓
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() =>
                void guard(async () => {
                  await chatClient.deleteHook(h.id);
                  setHooks((l) => l.filter((x) => x.id !== h.id));
                })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ol>
      <form className="flex flex-wrap gap-1" onSubmit={(e) => void add(e)}>
        <Select
          title="Hook type"
          hiddenLabel
          container="w-40"
          required={false}
          name="kind"
          options={(Object.keys(KIND) as Hook["kind"][]).map((k) => ({ value: k, label: KIND[k] }))}
        />
        <Input
          title="Hook pattern"
          hiddenLabel
          container="w-40"
          name="pattern"
          placeholder="Match (hide / stop)"
        />
        <Input
          title="Hook value"
          hiddenLabel
          container="w-48"
          name="value"
          placeholder="Text / replacement / task"
        />
        <Button type="submit" size="sm" variant="outline">
          Add hook
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <form className="space-y-1" onSubmit={(e) => void dry(e)}>
        <MentionTextarea
          title="Try a message against these hooks (nothing is sent to the bot)"
          className="mt-0.5"
          bots={bots}
          value={test}
          onChange={setTest}
          rows={2}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!test.trim()}>
          Test hooks
        </Button>
      </form>
      {result && (
        <div role="status" className="space-y-0.5 rounded-md border bg-card p-3 text-xs">
          <p>
            {result.stopped ? (
              <>
                This message would be stopped:{" "}
                <strong>{result.stopMessage || "(no message)"}</strong>
              </>
            ) : (
              "This message would go through."
            )}
          </p>
          <p className="break-words">Text the bot would see: {result.text || "(empty)"}</p>
          <p>
            Extra context added: {result.addedContext.length}
            {result.addedContext.length
              ? ` (${result.addedContext.join(" | ").slice(0, 200)})`
              : ""}
          </p>
          <p>Background tasks started: {result.backgroundTasks}</p>
          {result.skippedInvalid > 0 && (
            <p>Skipped {result.skippedInvalid} hook(s) with an invalid pattern.</p>
          )}
        </div>
      )}
    </section>
  );
}
