import { useEffect, useMemo, useRef, useState } from "react";
import { SparkleIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { Alert } from "@g4rcez/components/alert";
import type { AvatarValue } from "@/components/bot-avatar";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import type { Row } from "../chat/chat-rows";
import { Composer } from "../chat/composer";
import { MessageList } from "../chat/message-list";
import { FRESH_INTERVIEW, nextTemplateStep, type InterviewState } from "./interview-flow";

type Engine = {
  harness: string;
  model: string | null;
  name: string;
  description: string;
  avatar: AvatarValue | null;
};
type Props = {
  engine: Engine;
  state: InterviewState;
  setState: (s: InterviewState | ((s: InterviewState) => InterviewState)) => void;
  /** What is written now; sent along when refining. */
  draft: { personality: string; instructions: string };
  onDraft: (d: { personality?: string; instructions: string }) => void;
};

const TOTAL = 5;
const noop = () => {};
const actions = { onReact: noop, onReply: noop, onSaveInstruction: noop };

const READY_ENGINE =
  "Your draft is ready. Read it below. Tell me anything you'd like changed, or continue.";
const READY_BASIC =
  "Your basic draft is ready. It was filled from a template, not written by the engine. Read it below and edit the text there.";

/** The setup interview, drawn with the same list, rows and composer as a chat: the engine asks, the person answers, then it writes the draft. */
export function InstructionsInterview({ engine, state, setState, draft, onDraft }: Props) {
  const [answer, setAnswer] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const latest = useRef(0);
  const started = useRef(false);
  const t0 = useRef(Date.now());
  const hasDraft = draft.instructions.trim().length > 0;

  const patch = (p: Partial<InterviewState>) => setState((s) => ({ ...s, ...p }));

  /** Basic mode: the five fixed questions, no engine involved. */
  function basic(turns: InterviewState["turns"], notice: string | null) {
    const step = nextTemplateStep(turns);
    if (step.done) {
      onDraft({ instructions: step.instructions });
      setState((s) => ({
        ...s,
        turns,
        current: null,
        source: "template",
        notice: s.notice ?? notice,
        status: "idle",
        drafted: true,
      }));
    } else
      setState((s) => ({
        ...s,
        turns,
        current: { question: step.question, suggestions: step.suggestions },
        source: "template",
        notice: s.notice ?? notice,
        status: "idle",
        error: null,
      }));
  }

  async function ask(turns: InterviewState["turns"], refine?: { change: string }) {
    const id = ++latest.current;
    // Show the answer at once: the turn joins the log and the old question leaves it while the engine thinks.
    patch({ turns, current: null, status: "thinking", error: null });
    try {
      const r = await chatClient.interviewBot({
        harness: engine.harness,
        model: engine.model,
        name: engine.name.trim() || "New bot",
        description: engine.description,
        transcript: turns,
        ...(refine
          ? {
              refine: {
                ...refine,
                personality: draft.personality,
                instructions: draft.instructions,
              },
            }
          : {}),
      });
      if (id !== latest.current) return;
      if (r.kind === "unavailable") {
        if (refine) return patch({ status: "idle", error: r.reason });
        return basic([], r.reason);
      }
      if (r.kind === "question")
        return setState((s) => ({
          ...s,
          turns,
          current: { question: r.question, suggestions: r.suggestions },
          status: "idle",
        }));
      onDraft({ personality: r.personality, instructions: r.instructions });
      setState((s) => ({
        ...s,
        turns,
        current: null,
        status: "idle",
        drafted: true,
        summary: r.summary,
      }));
    } catch (e) {
      if (id !== latest.current) return;
      patch({ status: "idle", error: errorMessage(e) });
    }
  }

  // First visit with nothing written: start the interview. Coming back shows what exists instead.
  useEffect(() => {
    if (
      started.current ||
      hasDraft ||
      state.manual ||
      state.current ||
      state.drafted ||
      state.turns.length
    )
      return;
    started.current = true;
    void ask([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function send(text: string) {
    if (state.status === "thinking") return false;
    if (state.drafted || (hasDraft && !state.current)) {
      if (state.source === "template") return false;
      patch({ changes: [...state.changes, text] });
      void ask(state.turns, { change: text });
      return true;
    }
    if (!state.current) return false;
    const turns = [...state.turns, { question: state.current.question, answer: text }];
    if (state.source === "template") basic(turns, null);
    else void ask(turns);
    return true;
  }

  function restart() {
    latest.current++;
    started.current = true;
    setAnswer("");
    setState({ ...FRESH_INTERVIEW });
    void ask([]);
  }

  const thinking = state.status === "thinking";
  const finished = state.drafted || (hasDraft && !state.current && !thinking);
  const refining = finished && state.source === "engine";
  const asker = useMemo(
    () =>
      ({
        id: "new-bot",
        name: engine.name.trim() || "New bot",
        avatar: engine.avatar,
      }) as unknown as Bot,
    [engine.name, engine.avatar],
  );

  const rows = useMemo(() => {
    const out: Row[] = [];
    const add = (role: "assistant" | "user", content: string, more: Partial<Row> = {}) =>
      out.push({
        id: `i${out.length}`,
        seq: out.length,
        role,
        content,
        status: "complete",
        botId: role === "assistant" ? "new-bot" : null,
        createdAt: new Date(t0.current + out.length * 1000).toISOString(),
        ...more,
      });
    state.turns.forEach((t) => {
      add("assistant", t.question);
      add("user", t.answer);
    });
    if (finished) {
      add("assistant", state.source === "template" ? READY_BASIC : READY_ENGINE);
      state.changes.forEach((c) => add("user", c));
    } else if (state.current && !thinking) add("assistant", state.current.question);
    if (thinking) add("assistant", "", { streaming: true });
    return out;
  }, [state.turns, state.current, state.changes, state.source, finished, thinking]);

  const authorOf = (r: Row) =>
    r.role === "assistant" ? { name: asker.name, bot: asker } : { name: "You" };

  if (state.manual)
    return (
      <section aria-label="Write it yourself" className="rounded-lg border bg-card p-4 text-sm">
        <p className="text-muted-foreground">You're writing it yourself.</p>
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={restart}>
          <SparkleIcon className="size-4" aria-hidden="true" /> Let me be interviewed instead
        </Button>
      </section>
    );

  const placeholder = finished
    ? refining
      ? "Ask for a change, e.g. make it more formal"
      : "Edit a basic draft in the text below"
    : "Type your answer";
  const suggestions = !finished && !thinking ? (state.current?.suggestions ?? []) : [];
  const error = state.error ?? composerError;

  return (
    <section aria-label="Setup interview" className="space-y-3">
      {state.notice && (
        <Alert theme="warn">
          <strong>Basic draft.</strong> {state.notice} We'll ask five quick questions and fill in a
          template instead.
        </Alert>
      )}
      <div className="flex h-[min(32rem,62dvh)] flex-col overflow-hidden rounded-lg border bg-background">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
          <span>
            {finished
              ? "Draft ready"
              : state.current || thinking
                ? `Question ${Math.min(state.turns.length + 1, TOTAL)} of ${TOTAL}`
                : "Getting ready"}
          </span>
          {state.turns.length > 0 || finished ? (
            <button
              type="button"
              onClick={restart}
              className="underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              Start over
            </button>
          ) : null}
        </div>
        <MessageList
          rows={rows}
          authorOf={authorOf}
          fallbackBotId="new-bot"
          inThread
          readOnly
          busy={thinking}
          label="Setup interview"
          actions={actions}
        />
        <div className="space-y-2 border-t p-3">
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Example answers">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setAnswer(s)}
                  className="min-h-6 rounded-full border px-3 py-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {error && (
            <Alert theme="danger">
              {state.error ? "Couldn't reach the engine. " : ""}
              {error}{" "}
              {state.error && !finished && (
                <button type="button" className="underline" onClick={() => void ask(state.turns)}>
                  Try again
                </button>
              )}
            </Alert>
          )}
          <Composer
            minimal
            autoFocus
            value={answer}
            onChange={setAnswer}
            placeholder={placeholder}
            bots={[]}
            busy={thinking}
            disabled={(!state.current && !finished) || (finished && !refining)}
            onError={(e) => setComposerError(errorMessage(e))}
            onSubmit={(out) => {
              setComposerError(null);
              const ok = send(out.text.slice(0, 600));
              if (ok) setAnswer("");
              return ok;
            }}
          />
          <p className="px-1 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => patch({ manual: true })}
              className="underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              I'll write it myself
            </button>
          </p>
        </div>
      </div>
    </section>
  );
}
