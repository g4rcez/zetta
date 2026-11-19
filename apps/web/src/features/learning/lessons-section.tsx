import { Alert } from "@g4rcez/components/alert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Select } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { relativeTime } from "../shared/relative-time";
import { Badge, Empty, list, listItem } from "../shared/ui";
import {
  learningApi,
  learningQueries,
  type LearningPolicy,
  type LessonAction,
  type LessonView,
} from "./learning-api";

type Act = (id: string, action: LessonAction) => Promise<void>;
type Edit = (id: string, text: string) => Promise<void>;

const DROP_REASON: Record<NonNullable<LessonView["dropReason"]>, string> = {
  bad_results: "You had to step in too often after it.",
  unused: "Nothing used it for a while.",
  person: "You removed it.",
  superseded: "A newer lesson replaced it.",
  duplicate: "It repeated another lesson.",
};
const BASIS: Record<NonNullable<LessonView["basis"]>, string> = {
  said: "You said it outright.",
  repeated: "You said it more than once.",
  person: "You accepted it.",
  old: "A skill this bot learned before lessons existed.",
};
const SECTIONS: { id: string; title: string; hint: string; pick: (l: LessonView) => boolean }[] = [
  {
    id: "waiting-you",
    title: "Waiting for you",
    hint: "They passed the checks. The bot is set to suggest, or it is steps rather than a short rule.",
    pick: (l) => l.status === "candidate" && l.basis !== null,
  },
  {
    id: "waiting-second",
    title: "Waiting for a second time",
    hint: "Said once so far. A lesson starts when you say it again, in another chat or on another day.",
    pick: (l) => l.status === "candidate" && l.basis === null,
  },
  {
    id: "trial",
    title: "On trial",
    hint: "In use now, and judged by what happens after the replies that used it.",
    pick: (l) => l.status === "trial",
  },
  {
    id: "kept",
    title: "Kept",
    hint: "They passed their trial.",
    pick: (l) => l.status === "kept",
  },
];
const ENDED = (l: LessonView) =>
  l.status === "dropped" || l.status === "rejected" || l.status === "expired";

function LessonRow({
  lesson,
  bots,
  busy,
  onAct,
  onEdit,
}: {
  lesson: LessonView;
  bots: Bot[];
  busy: boolean;
  onAct: Act;
  onEdit: Edit;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.text);
  const proof = lesson.evidence[0];
  const canEdit = lesson.skillName === null && lesson.status !== "dropped" && !ENDED(lesson);
  return (
    <li className={listItem}>
      <div className="space-y-1.5">
        {editing ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onEdit(lesson.id, text.trim()).then(() => setEditing(false));
            }}
          >
            <MentionTextarea
              title="The lesson"
              bots={bots}
              rows={2}
              maxLength={300}
              required
              value={text}
              onChange={setText}
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !text.trim() || text.trim() === lesson.text}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setText(lesson.text);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 font-medium text-pretty">{lesson.text}</p>
            <div className="flex items-center gap-1.5">
              {lesson.scope === "always" && <Badge>Every reply</Badge>}
              {lesson.skillName && <Badge tone="info">Skill</Badge>}
              {lesson.kind === "procedure" && !lesson.skillName && (
                <Badge tone="warning">Steps</Badge>
              )}
            </div>
          </div>
        )}
        {proof && (
          <p className="text-xs text-muted-foreground">
            You wrote: “{proof.quote}” · {proof.day}
            {lesson.seen.chats > 1 || lesson.seen.days > 1
              ? ` · seen in ${lesson.seen.chats} chats on ${lesson.seen.days} days`
              : ""}
          </p>
        )}
        {lesson.basis && lesson.status !== "candidate" && (
          <p className="text-xs text-muted-foreground">{BASIS[lesson.basis]}</p>
        )}
        {lesson.status === "candidate" && lesson.basis && (
          <p className="text-xs text-muted-foreground">
            {BASIS[lesson.basis]}
            {lesson.kind === "procedure"
              ? " It is steps: turn it into a memory item or a skill yourself."
              : ""}
          </p>
        )}
        {lesson.results && lesson.status !== "dropped" && (
          <p className="text-xs text-pretty">{lesson.results.reason}</p>
        )}
        {ENDED(lesson) && (
          <p className="text-xs text-muted-foreground">
            {lesson.status === "expired"
              ? "Nobody said it a second time, so it was closed."
              : lesson.status === "rejected"
                ? "Turned down."
                : lesson.dropReason
                  ? DROP_REASON[lesson.dropReason]
                  : "Dropped."}{" "}
            {relativeTime(lesson.updatedAt)}
          </p>
        )}
        {!editing && (
          <div className="flex flex-wrap gap-2 pt-1">
            {lesson.status === "candidate" && lesson.kind === "rule" && (
              <Button
                size="sm"
                type="button"
                disabled={busy}
                onClick={() => void onAct(lesson.id, "accept")}
              >
                Start it
              </Button>
            )}
            {lesson.status === "candidate" && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onAct(lesson.id, "reject")}
              >
                Turn down
              </Button>
            )}
            {lesson.status === "trial" && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onAct(lesson.id, "keep")}
              >
                Keep
              </Button>
            )}
            {(lesson.status === "trial" || lesson.status === "kept") && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onAct(lesson.id, "drop")}
              >
                Drop
              </Button>
            )}
            {lesson.status === "dropped" && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onAct(lesson.id, "restore")}
              >
                Bring back
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function LessonGroup({
  title,
  hint,
  lessons,
  bots,
  busy,
  onAct,
  onEdit,
}: {
  title: string;
  hint: string;
  lessons: LessonView[];
  bots: Bot[];
  busy: boolean;
  onAct: Act;
  onEdit: Edit;
}) {
  if (!lessons.length) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">
          {title} <span className="font-normal text-muted-foreground">({lessons.length})</span>
        </h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ul className={list}>
        {lessons.map((l) => (
          <LessonRow key={l.id} lesson={l} bots={bots} busy={busy} onAct={onAct} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  );
}

const STRICTNESS = [
  { value: "strict", label: "Strict: kept after 8 clean uses, dropped at the first bad one" },
  { value: "normal", label: "Normal: kept after 5 uses, dropped after 2 bad ones" },
  { value: "loose", label: "Loose: kept after 3 uses, dropped after 3 bad ones" },
];

function PolicyForm({
  policy,
  onChange,
}: {
  policy: LearningPolicy;
  onChange: (p: Partial<LearningPolicy>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="What may happen by itself">
      <Select
        title="Read my chats"
        required={false}
        value={policy.batch}
        onChange={(e) => onChange({ batch: e.target.value as LearningPolicy["batch"] })}
        options={[
          { value: "daily", label: "Once a day" },
          { value: "off", label: "Only when I ask" },
        ]}
      />
      <Select
        title="Lessons that do not help"
        required={false}
        value={policy.forget}
        onChange={(e) => onChange({ forget: e.target.value as LearningPolicy["forget"] })}
        options={[
          { value: "on", label: "Drop them by themselves" },
          { value: "off", label: "I decide" },
        ]}
      />
      <Select
        title="Tidy-up suggestions"
        required={false}
        value={policy.tidy}
        onChange={(e) => onChange({ tidy: e.target.value as LearningPolicy["tidy"] })}
        options={[
          { value: "weekly", label: "Once a week" },
          { value: "off", label: "Never" },
        ]}
      />
      <Select
        title="How strict the trial is"
        required={false}
        value={policy.strictness}
        onChange={(e) => onChange({ strictness: e.target.value as LearningPolicy["strictness"] })}
        options={STRICTNESS}
      />
    </div>
  );
}

/**
 * What a bot learned from its owner: the lessons by where they stand, with the person's own words as evidence and the say over each,
 * a "read my chats now" button, and what may happen by itself (docs/decisions/lessons.md).
 */
export function LessonsSection({ bot, bots }: { bot: Bot; bots: Bot[] }) {
  const qc = useQueryClient();
  const lessonsQuery = useQuery(learningQueries.lessons({ bot: bot.id }));
  const policyQuery = useQuery(learningQueries.policy());
  const overviewQuery = useQuery(learningQueries.overview(bot.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [showEnded, setShowEnded] = useState(false);
  const lessons = lessonsQuery.data ?? [];
  const overview = overviewQuery.data;
  const last = overview?.runs[0];
  const reading = last?.status === "running";
  const refresh = () => qc.invalidateQueries({ queryKey: ["learning"] });
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await work();
      if (done) setStatus(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const cooling = overview?.runNowAfter && new Date(overview.runNowAfter).getTime() > Date.now();
  const off = bot.autoLearn === "off";
  const ended = lessons.filter(ENDED);
  return (
    <div className="space-y-5">
      {(error || lessonsQuery.error) && (
        <Alert theme="danger">{error ?? errorMessage(lessonsQuery.error)}</Alert>
      )}
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          type="button"
          disabled={busy || reading || off || Boolean(cooling)}
          onClick={() =>
            void run(
              () => learningApi.runNow(bot.id),
              "Reading your chats. The result appears below.",
            )
          }
        >
          {reading ? "Reading your chats…" : "Read my chats now"}
        </Button>
        <p className="min-w-0 text-xs text-muted-foreground">
          {off
            ? "This bot is set not to learn. Turn learning on in the Learning section above."
            : cooling
              ? `Open again ${relativeTime(overview!.runNowAfter!)}.`
              : last
                ? `Last read ${relativeTime(last.startedAt)}${last.detail ? `: ${last.detail}` : ""}`
                : "Once a day, after your chats go quiet, the bot reads what you said to it and looks for lessons."}
        </p>
      </div>
      {policyQuery.data && (
        <PolicyForm
          policy={policyQuery.data}
          onChange={(patch) => void run(() => learningApi.setPolicy(patch), "Saved.")}
        />
      )}
      {lessonsQuery.data && lessons.length === 0 && (
        <Empty>
          Nothing learned yet. When you correct this bot or tell it how you want things done, it
          picks that up from your chats.
        </Empty>
      )}
      {SECTIONS.map((s) => (
        <LessonGroup
          key={s.id}
          title={s.title}
          hint={s.hint}
          lessons={lessons.filter(s.pick)}
          bots={bots}
          busy={busy}
          onAct={(id, action) => run(() => learningApi.act(id, action))}
          onEdit={(id, text) => run(() => learningApi.edit(id, text))}
        />
      ))}
      {ended.length > 0 && (
        <div className="space-y-2">
          <Button
            size="sm"
            type="button"
            variant="outline"
            aria-expanded={showEnded}
            onClick={() => setShowEnded(!showEnded)}
          >
            {showEnded ? "Hide" : "Show"} dropped and turned down ({ended.length})
          </Button>
          {showEnded && (
            <LessonGroup
              title="Dropped and turned down"
              hint="Nothing is deleted. Bring a lesson back and it starts its trial again."
              lessons={ended}
              bots={bots}
              busy={busy}
              onAct={(id, action) => run(() => learningApi.act(id, action))}
              onEdit={(id, text) => run(() => learningApi.edit(id, text))}
            />
          )}
        </div>
      )}
    </div>
  );
}
