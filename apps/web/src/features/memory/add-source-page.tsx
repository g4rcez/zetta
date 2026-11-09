import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { EditorField } from "@/components/editor/editor";
import { Button, Input, Select } from "@/components/ui";
import { call } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Badge, field, list, listItem } from "../shared/ui";
import { Segmented } from "../tasks/task-filter-bar";
import { useAction } from "./use-action";
import {
  memoryQueries,
  type Bot,
  type Checks,
  type IngestStarted,
  type Screen,
} from "./memory-api";

export const SOURCE_FROM = ["url", "text", "file"] as const;
export type SourceFrom = (typeof SOURCE_FROM)[number];
/** What the address holds: which way the source comes in. `url` is the default and stays out of the address. */
export type AddSourceSearch = { from?: "text" | "file" };
export const parseAddSourceSearch = (raw: Record<string, unknown>): AddSourceSearch =>
  raw.from === "text" || raw.from === "file" ? { from: raw.from } : {};

/** The most characters a source holds (the server's limit, MEMORY_LIMITS.source). */
const MAX_CHARS = 100_000;
const TABS = [
  { value: "url", label: "Web page" },
  { value: "text", label: "Pasted text" },
  { value: "file", label: "File" },
] as const satisfies readonly { value: SourceFrom; label: string }[];

/** What the screen found, in words, with each passage that was cut out of the copy a bot reads. */
function ScreenReport({ screen }: { screen: Screen }) {
  return (
    <div className="space-y-2 text-sm">
      {screen.note && <p>{screen.note}</p>}
      {screen.spans.length > 0 && (
        <ul className="space-y-1.5" aria-label="Passages the check flagged">
          {screen.spans.map((s) => (
            <li key={`${s.by}:${s.quote}`} className="rounded-md border bg-muted/40 p-2">
              <blockquote className="whitespace-pre-wrap break-words">{s.quote}</blockquote>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.why} · found by {s.by === "model" ? "your chief" : "a pattern check"}
                {s.located ? "" : " · not found in the text, so it could not be removed"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A source the check held back. The person reads what it found, and may still add it: the bot then reads the cleaned copy and asks for each change. */
function HeldSource({
  job,
  onForce,
}: {
  job: Checks["jobs"][number];
  onForce: (id: string) => void;
}) {
  return (
    <li className={`${listItem} space-y-2`}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="warning">Held</Badge>
        <span className="font-medium">{job.sourceTitle ?? "A source"}</span>
      </p>
      {job.screen && <ScreenReport screen={job.screen} />}
      <p className="text-xs text-muted-foreground">
        If you add it anyway, a bot reads a copy without the flagged passages, and every change it
        wants to make to your memory waits for your approval in the chat.
      </p>
      <Button size="xs" variant="outline" onClick={() => onForce(job.id)}>
        Add it anyway
      </Button>
    </li>
  );
}

const INGEST_STATUS = {
  pending: "Working",
  running: "Working",
  done: "Done",
  failed: "Could not finish",
  skipped: "Skipped",
} as const;

/** The sources added lately: held ones ask for a decision, the others link to their chat and to the source item. */
function RecentSources({ jobs, onForce }: { jobs: Checks["jobs"]; onForce: (id: string) => void }) {
  const ingests = jobs.filter((j) => j.kind === "ingest");
  if (!ingests.length) return null;
  return (
    <section aria-labelledby="recent-sources" className="space-y-2">
      <h2 id="recent-sources" className="text-sm font-medium">
        Added lately
      </h2>
      <ul className={list}>
        {ingests.map((j) =>
          j.status === "blocked" ? (
            <HeldSource key={j.id} job={j} onForce={onForce} />
          ) : (
            <li key={j.id} className={`${listItem} flex flex-wrap items-center gap-2 text-sm`}>
              <Badge
                tone={
                  j.status === "done" ? "success" : j.status === "failed" ? "danger" : "neutral"
                }
              >
                {INGEST_STATUS[j.status as keyof typeof INGEST_STATUS] ?? "Skipped"}
              </Badge>
              {j.sourceSlug ? (
                <Link
                  to="/memory/$slug"
                  params={{ slug: j.sourceSlug }}
                  className="font-medium hover:underline"
                >
                  {j.sourceTitle ?? j.sourceSlug}
                </Link>
              ) : (
                <span>A source</span>
              )}
              {j.conversationId && (
                <Link
                  to="/chat/{-$chatId}"
                  params={{ chatId: j.conversationId }}
                  className="text-muted-foreground hover:underline"
                >
                  Open the chat
                </Link>
              )}
              {j.screen && j.screen.verdict !== "clean" && (
                <Badge tone="warning">Passages removed</Badge>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/** Reads a chosen file as text. Anything that is not text, or too long, is refused here with a sentence; the server checks again. */
async function readFile(f: File): Promise<{ text: string } | { error: string }> {
  const text = await f.text();
  if (text.includes("\0"))
    return { error: "That file is not text. Add a text, Markdown, CSV or JSON file." };
  if (text.length > MAX_CHARS)
    return {
      error: `That file is too long (${MAX_CHARS.toLocaleString()} characters at most). Split it.`,
    };
  return { text };
}

/** Add a source to the memory: a web page, pasted text or a file. Its text is kept unchanged; a bot reads a checked copy and writes the items it informs. */
export function AddSourcePage({
  from,
  setFrom,
}: {
  from: SourceFrom;
  setFrom: (from: SourceFrom) => void;
}) {
  const navigate = useNavigate();
  const bots = useQuery(chatQueries.bots()).data as Bot[] | undefined;
  const checks = useQuery({ ...memoryQueries.checks(), refetchInterval: 5000 });
  const { run, feedback, setError } = useAction();
  const [busy, setBusy] = useState(false);
  const toChat = (r: Pick<IngestStarted, "conversationId">) => {
    if (r.conversationId)
      void navigate({ to: "/chat/{-$chatId}", params: { chatId: r.conversationId } });
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const title = String(f.get("title") ?? "").trim();
    const botId = String(f.get("botId") ?? "");
    const common = { ...(title && { title }), ...(botId && { botId }) };
    setBusy(true);
    void run(async () => {
      try {
        let body: object;
        if (from === "url")
          body = { kind: "url", url: String(f.get("url") ?? "").trim(), ...common };
        else if (from === "text")
          body = { kind: "text", text: String(f.get("text") ?? ""), ...common };
        else {
          const file = f.get("file");
          if (!(file instanceof File) || !file.size) throw new Error("Choose a file first.");
          const read = await readFile(file);
          if ("error" in read) throw new Error(read.error);
          body = { kind: "file", name: file.name, text: read.text, ...common };
        }
        const r = await call<IngestStarted>("/api/memory-ingest", "POST", body);
        if (r.status === "blocked") return; // the held source is listed below, with what the check found
        form.reset();
        toChat(r);
      } finally {
        setBusy(false);
      }
    }, "Added. A bot is reading it now.");
  };
  const force = (id: string) =>
    void run(
      async () => toChat(await call<IngestStarted>(`/api/memory-ingest/${id}/force`, "POST", {})),
      "Added.",
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/memory" className="hover:underline">
            Memory
          </Link>{" "}
          / Add a source
        </nav>
        <header className="space-y-2">
          <h1>Add a source</h1>
          <p className="text-sm text-muted-foreground">
            The original text is kept unchanged, as a source item that bots can read and never edit.
            A bot reads a checked copy and updates the items it informs, in a chat you can watch.
            Text addressed to an AI is taken out of that copy first.
          </p>
        </header>
        <Segmented
          label="Where it comes from"
          value={from}
          options={[...TABS]}
          onChange={(v) => {
            setError(undefined);
            setFrom(v);
          }}
        />
        <form onSubmit={submit} className="space-y-4" aria-label="Add a source">
          {from === "url" && (
            <Input
              title="Web address"
              name="url"
              type="url"
              required
              placeholder="https://"
              maxLength={2000}
            />
          )}
          {from === "text" && (
            // Plain on purpose: pasted external content, which a mention picker would get in the way of.
            <EditorField title="Text" name="text" required rows={12} maxLength={MAX_CHARS} />
          )}
          {from === "file" && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">File (text, Markdown, CSV or JSON)</span>
              <input
                name="file"
                type="file"
                required
                accept=".txt,.md,.markdown,.csv,.json,.log,text/*"
                className={field}
              />
            </label>
          )}
          <Input title="Title (optional)" name="title" maxLength={160} />
          <Select
            title="Bot that reads it"
            name="botId"
            required={false}
            defaultValue=""
            options={[
              { value: "", label: "Your chief" },
              ...(bots ?? [])
                .filter((b) => b.kind !== "chief")
                .map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Checking the source…" : "Add to memory"}
            </Button>
            {bots?.find((b) => b.kind === "chief") && (
              <BotIdentity
                bot={bots.find((b) => b.kind === "chief")!}
                size={20}
                className="w-auto flex-none text-muted-foreground"
              />
            )}
          </div>
          {feedback}
        </form>
        <RecentSources jobs={checks.data?.jobs ?? []} onForce={force} />
      </div>
    </div>
  );
}
