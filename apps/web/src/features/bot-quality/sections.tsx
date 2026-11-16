import { PlayIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ActionHint } from "@/components/action-hint";
import { Button, Input } from "@/components/ui";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { lineDiff } from "../skills/diff";
import { relativeTime } from "../shared/relative-time";
import { Badge } from "../shared/ui";
import {
  qualityApi,
  qualityQueries,
  type BotConfigSnapshot,
  type DrivePrompt,
  type DriveRun,
  type Revision,
} from "./bot-quality-api";

export type SectionProps = { bot: Bot; onBotChange: (b: Bot) => void; notify: (m: string) => void };

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  description: "description",
  harness: "engine",
  model: "model",
  personality: "personality",
  instructions: "instructions",
  outputStyle: "output style",
  outputStyleId: "output style",
  visibility: "who can use it",
  fallbackHarness: "fallback engine",
  fallbackModel: "fallback model",
  computerMode: "computer use",
  autoLearn: "learning",
  codeAccess: "code access",
  commitIdentity: "commit identity",
  commitEmail: "commit e-mail",
  contextBytes: "memory of the chat",
  summaryMode: "summary of older messages",
  summaryMaxChars: "summary length",
  summaryGapBytes: "when the summary refreshes",
  chatSearchLimit: "search results",
};
const labelOf = (fields: string[]) =>
  [...new Set(fields.map((f) => FIELD_LABELS[f] ?? f))].join(", ");

function Failure({ error }: { error: string | undefined }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

/** The two texts a person edits most, compared with the version now. Everything else is named, not drawn. */
function TextChange({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-56 overflow-auto rounded border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
        {lineDiff(before, after).map((l, i) => (
          <span
            key={i}
            className={
              l.kind === "add"
                ? "block bg-success/15"
                : l.kind === "del"
                  ? "block bg-destructive/15 line-through"
                  : "block text-muted-foreground"
            }
          >
            {l.text || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

function RevisionRow({
  revision,
  now,
  open,
  confirming,
  busy,
  onOpen,
  onAsk,
  onCancel,
  onRestore,
}: {
  revision: Revision;
  now: BotConfigSnapshot;
  open: boolean;
  confirming: boolean;
  busy: boolean;
  onOpen: () => void;
  onAsk: () => void;
  onCancel: () => void;
  onRestore: () => void;
}) {
  return (
    <li className="space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Version {revision.version}</span>
        {revision.current && <Badge tone="success">Now</Badge>}
        <span className="text-xs text-muted-foreground">{relativeTime(revision.createdAt)}</span>
        {revision.changed.length > 0 && (
          <span className="min-w-0 text-xs text-muted-foreground">
            changed {labelOf(revision.changed)}
          </span>
        )}
        {!revision.current && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" aria-expanded={open} onClick={onOpen}>
              {open ? "Hide changes" : "See changes"}
            </Button>
            {confirming ? (
              <>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  Keep the current one
                </Button>
                <Button size="sm" disabled={busy} onClick={onRestore}>
                  {busy ? "Restoring…" : "Yes, bring it back"}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={onAsk}>
                Bring it back
              </Button>
            )}
          </span>
        )}
      </div>
      {open && !revision.current && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            What this version said, compared with the bot now (red goes away, green comes back).
          </p>
          <TextChange
            label="Instructions"
            before={now.instructions ?? ""}
            after={revision.config.instructions ?? ""}
          />
          <TextChange
            label="Personality"
            before={now.personality ?? ""}
            after={revision.config.personality ?? ""}
          />
          {revision.config.instructions === now.instructions &&
            revision.config.personality === now.personality && (
              <p className="text-xs text-muted-foreground">
                The texts are the same; the difference is in{" "}
                {labelOf(
                  Object.keys(revision.config).filter(
                    (k) =>
                      JSON.stringify(revision.config[k as keyof BotConfigSnapshot]) !==
                      JSON.stringify(now[k as keyof BotConfigSnapshot]),
                  ),
                )}
                .
              </p>
            )}
        </div>
      )}
    </li>
  );
}

/** Every saved version of the bot. Bringing one back makes a new version, so nothing in the history is lost. */
export function HistorySection({ bot, onBotChange, notify }: SectionProps) {
  const qc = useQueryClient();
  const history = useQuery(qualityQueries.revisions(bot.id));
  const [open, setOpen] = useState<number>();
  const [asking, setAsking] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (history.isPending) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  if (history.error || !history.data) return <Failure error={errorMessage(history.error)} />;
  const rows = history.data.revisions;
  const now = rows.find((r) => r.current)?.config ?? {};
  async function restore(version: number) {
    setBusy(true);
    setError(undefined);
    try {
      await qualityApi.restore(bot.id, version, bot.version);
      const fresh = (await chatClient.bots()).find((b) => b.id === bot.id);
      if (fresh) onBotChange(fresh);
      await qc.invalidateQueries({ queryKey: ["bot-quality"] });
      setAsking(undefined);
      notify(`Version ${version} is back, as a new version.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <Failure error={error} />
      <ul className="divide-y">
        {rows.map((r) => (
          <RevisionRow
            key={r.version}
            revision={r}
            now={now}
            open={open === r.version}
            confirming={asking === r.version}
            busy={busy}
            onOpen={() => setOpen(open === r.version ? undefined : r.version)}
            onAsk={() => setAsking(r.version)}
            onCancel={() => setAsking(undefined)}
            onRestore={() => void restore(r.version)}
          />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Versions saved before the quality tools hold the texts, engine and model only; bringing one
        back leaves the other settings as they are.
      </p>
    </div>
  );
}

function RunAnswer({ run, label }: { run: DriveRun | undefined; label: string }) {
  return (
    <div className="min-w-0 flex-1 basis-56 space-y-1 rounded border p-2">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>
        {run && <span>{relativeTime(run.createdAt)}</span>}
      </p>
      {!run ? (
        <p className="text-xs text-muted-foreground">Not run yet.</p>
      ) : run.status === "running" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Running…
        </p>
      ) : run.status === "failed" ? (
        <p role="alert" className="text-xs text-destructive">
          {run.error || "It did not finish."}
        </p>
      ) : (
        <p className="max-h-60 overflow-auto text-sm whitespace-pre-wrap">{run.answer}</p>
      )}
    </div>
  );
}

function PromptCard({
  prompt,
  botVersion,
  busy,
  onRun,
  onRemove,
}: {
  prompt: DrivePrompt;
  botVersion: number;
  busy: boolean;
  onRun: () => void;
  onRemove: () => void;
}) {
  const [latest, before] = prompt.runs;
  const running = prompt.runs.some((r) => r.status === "running");
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{prompt.title}</p>
          <p className="text-sm text-pretty text-muted-foreground">{prompt.prompt}</p>
        </div>
        <Button size="sm" variant="secondary" disabled={busy || running} onClick={onRun}>
          <PlayIcon aria-hidden="true" />
          {running ? "Running…" : "Run"}
        </Button>
        <ActionHint label="Remove this saved test">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Remove this saved test"
            onClick={onRemove}
          >
            <TrashIcon />
          </Button>
        </ActionHint>
      </div>
      <div className="flex flex-wrap gap-2">
        <RunAnswer
          run={latest}
          label={
            latest
              ? `Version ${latest.botVersion}${latest.botVersion === botVersion ? " (now)" : ""}`
              : "Latest"
          }
        />
        <RunAnswer run={before} label={before ? `Version ${before.botVersion}` : "Before"} />
      </div>
    </li>
  );
}

/** Questions to ask again after changing the bot: run them, and read the new answer next to the one before. */
export function SavedTestsSection({ bot }: SectionProps) {
  const qc = useQueryClient();
  const drive = useQuery(qualityQueries.drive(bot.id));
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (drive.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (drive.error || !drive.data) return <Failure error={errorMessage(drive.error)} />;
  const { prompts, limit } = drive.data;
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      await qc.invalidateQueries({ queryKey: ["bot-quality", "drive", bot.id] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const canRun = prompts.length > 0 && !["fixture", "decision"].includes(bot.harness);
  return (
    <div className="space-y-4 text-sm">
      <Failure error={error} />
      {prompts.length > 0 && (
        <ul className="space-y-3">
          {prompts.map((p) => (
            <PromptCard
              key={p.id}
              prompt={p}
              botVersion={bot.version}
              busy={busy}
              onRun={() => void act(() => qualityApi.run(bot.id, p.id))}
              onRemove={() => void act(() => qualityApi.removePrompt(bot.id, p.id))}
            />
          ))}
        </ul>
      )}
      {canRun && prompts.length > 1 && (
        <Button size="sm" disabled={busy} onClick={() => void act(() => qualityApi.run(bot.id))}>
          <PlayIcon aria-hidden="true" /> Run all
        </Button>
      )}
      {prompts.length < limit ? (
        <form
          className="space-y-2 rounded-lg border border-dashed p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await qualityApi.addPrompt(bot.id, title.trim(), text.trim());
              setTitle("");
              setText("");
            });
          }}
        >
          <Input
            title="Name of the test"
            value={title}
            maxLength={80}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
          <MentionTextarea
            title="What to ask"
            bots={[]}
            rows={3}
            maxLength={4000}
            required
            value={text}
            onChange={setText}
            placeholder="Summarise this week's open tasks in three lines."
          />
          <Button type="submit" size="sm" disabled={busy || !title.trim() || !text.trim()}>
            Save this test
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          A bot keeps {limit} saved tests. Remove one to add another.
        </p>
      )}
      <p className="text-xs text-pretty text-muted-foreground">
        Each run uses the bot as it is now, in a chat that is not in your lists. It can use the
        bot's tools, so keep the questions to things that are safe to ask again.
      </p>
    </div>
  );
}

const ms = (n: number | null) =>
  n === null
    ? "—"
    : n < 1000
      ? `${n} ms`
      : n < 60_000
        ? `${(n / 1000).toFixed(1)} s`
        : `${(n / 60_000).toFixed(1)} min`;

function StatList({ title, items }: { title: string; items: [string, string | number][] }) {
  return (
    <section className="min-w-0 flex-1 basis-60 space-y-1 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PeriodStats({ botId, days }: { botId: string; days: 7 | 30 }) {
  const q = useQuery(qualityQueries.stats(botId, days));
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <Failure error={errorMessage(q.error)} />;
  const s = q.data;
  const title = `Last ${days} days`;
  return (
    <div className="flex flex-wrap gap-3">
      <StatList
        title={title}
        items={[
          ["Answers", s.runs.total],
          ["Finished", s.runs.ok],
          ["Failed", s.runs.failed],
          ["Stopped by you", s.runs.cancelled],
          ["Median time to answer", ms(s.duration.medianMs)],
          ["Slowest 1 in 10", ms(s.duration.p90Ms)],
        ]}
      />
      <StatList
        title="Had to step in"
        items={[
          ["Answers you stopped", s.stepIn.cancelledReplies],
          ["Times you steered it", s.stepIn.steered],
          ["Changes it asked you to approve", s.stepIn.approvalCards],
          ["Times it needed you", s.stepIn.askedYou],
          ["Good answers", s.feedback.up],
          ["Bad answers", s.feedback.down],
        ]}
      />
    </div>
  );
}

/** What the bot did lately and how often you had to step in, from its audit trail and your ratings. */
export function PerformanceSection({ bot }: SectionProps) {
  return (
    <div className="space-y-4">
      <PeriodStats botId={bot.id} days={7} />
      <PeriodStats botId={bot.id} days={30} />
      <p className="text-xs text-pretty text-muted-foreground">
        Time to answer is counted from the first moment the bot started on a reply; answers from
        before this was recorded are left out. Rate an answer with the thumbs on a message.
      </p>
    </div>
  );
}
