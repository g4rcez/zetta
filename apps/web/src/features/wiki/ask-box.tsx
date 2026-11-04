import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mentionsAsText } from "@zetta/core/mentions";
import { Link } from "@tanstack/react-router";
import { PaperPlaneRightIcon, SparkleIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { chatClient, errorMessage, type Bot as ChatBot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { MentionField } from "../chat/mention";
import { Response, type WikiLinkInfo } from "../chat/response";
import { useZettaChat } from "../chat/use-zetta-chat";
import { Badge } from "../shared/ui";
import { ASK_SCOPE_MAX, askPrompt, sourcesOf, type Source } from "./wiki-ask";

type Answer = { question: string; text: string; shown: Source[]; chatId: string };

/** A chief that can answer: the fixture and decision harnesses only simulate or route, they never read the wiki. */
const canAnswer = (b: ChatBot) =>
  b.kind === "chief" && b.onboarded && !["fixture", "decision"].includes(b.harness);

/**
 * "Ask your memory": the user's chief answers in place, streamed, from the wiki. Every question is its own conversation, archived once the
 * answer is saved so it does not fill the chat list; "Continue in chat" opens it. `scope` limits the bot to given items.
 * The question is typed in the chat's own text box (`MentionField`), so `@` and `#` work as in the chat (CLAUDE.md "Free text").
 */
export function AskBox({
  scope,
  wikiLinks,
  autoFocus,
}: {
  scope?: { ids: string[]; label: string } | undefined;
  wikiLinks: WikiLinkInfo | undefined;
  autoFocus?: boolean;
}) {
  const qc = useQueryClient();
  const botsQuery = useQuery(chatQueries.bots());
  const bots = botsQuery.data;
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string>();
  const [conversationId, setConversationId] = useState<string>();
  const [answer, setAnswer] = useState<Answer>();
  const [error, setError] = useState<string>();
  const [limit, setLimit] = useState(true);
  useEffect(() => {
    if (botsQuery.error) setError(errorMessage(botsQuery.error));
  }, [botsQuery.error]);
  const chief = bots?.find(canAnswer);

  const chat = useZettaChat({
    conversationId,
    onSettled: async (id) => {
      try {
        // The answer was just saved: never take an older copy from the cache.
        const messages = await qc.fetchQuery({ ...chatQueries.messages(id), staleTime: 0 });
        const last = messages.filter((m) => m.role === "assistant").at(-1);
        if (!last || last.status !== "complete") {
          setError("The chief could not answer. Try again.");
          return;
        }
        const used = await chatClient.usedKnowledge(last.id);
        setAnswer({
          question: asked ?? "",
          text: last.content,
          shown: used.wiki.map((w) => ({ slug: w.slug, title: w.title })),
          chatId: id,
        });
        setAsked(undefined);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        // The answer is kept on this page; the conversation leaves the chat list but "Continue in chat" still opens it.
        // A failed question leaves it too: nobody wants a dead conversation in the list.
        await chatClient.updateConversation(id, { archived: true }).catch(() => {});
        void qc.invalidateQueries({ queryKey: chatQueries.conversations().queryKey });
      }
    },
  });

  const ids = scope && limit ? scope.ids.slice(0, ASK_SCOPE_MAX) : [];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = question.trim();
    if (!text || !chief || chat.busy) return;
    setError(undefined);
    setAnswer(undefined);
    setAsked(text);
    try {
      const c = await chatClient.startConversation(chief.id);
      setConversationId(c.id);
      await chat.send(askPrompt(text), {
        conversationId: c.id,
        ...(ids.length && { wikiIds: ids }),
      });
    } catch (err) {
      setAsked(undefined);
      setError(errorMessage(err));
    }
  };
  const live = chat.rows.filter((r) => r.role === "assistant").at(-1);
  const sources = answer ? sourcesOf(answer.text, answer.shown) : undefined;

  const hasOutput = Boolean(error || chat.busy || answer);
  return (
    <section aria-labelledby="wiki-ask" className="rounded-xl border bg-card p-3">
      <h2 id="wiki-ask" className="sr-only">
        Ask your memory
      </h2>
      {bots && !chief ? (
        <p className="px-1 text-sm text-muted-foreground">
          Asking needs a chief bot that is set up and uses a real engine. Open your chief in the
          chat to finish its setup.
        </p>
      ) : (
        <form
          onSubmit={(e) => void submit(e)}
          className="flex items-start gap-2 rounded-md focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ring"
        >
          {/* The icon and the button stay level with the first line, however many lines the question grows to. */}
          <span className="flex h-9 shrink-0 items-center">
            <SparkleIcon aria-hidden="true" className="ml-1 size-4 text-muted-foreground" />
          </span>
          <MentionField
            aria-label="Ask your memory"
            value={question}
            onChange={setQuestion}
            bots={bots ?? []}
            placeholder="Ask your memory, e.g. how do refunds work?"
            rows={1}
            maxLength={2000}
            autoFocus={autoFocus}
            disabled={!chief}
            wrapperClassName="min-w-0 flex-1"
            // Enter asks and Shift+Enter adds a line, like the chat.
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
              e.preventDefault();
              (e.target as HTMLElement).closest("form")?.requestSubmit();
            }}
            className="block min-h-9 w-full bg-transparent py-2 text-sm leading-5 [--editor-max-height:10rem]"
          />
          <span className="flex h-9 shrink-0 items-center">
            {chat.busy ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void chat.stop()}>
                <StopIcon aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!question.trim() || !chief}>
                <PaperPlaneRightIcon aria-hidden="true" />
                Ask
              </Button>
            )}
          </span>
        </form>
      )}
      {scope && scope.ids.length > 0 && (
        <label className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} />
          {scope.label}
          {scope.ids.length > ASK_SCOPE_MAX ? ` (the first ${ASK_SCOPE_MAX})` : ""}
        </label>
      )}
      <div
        aria-live="polite"
        aria-busy={chat.busy}
        className={hasOutput ? "mt-3 space-y-2 border-t pt-3" : undefined}
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {chat.busy && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            {live?.content ? (
              <Response text={live.content} streaming wikiLinks={wikiLinks} />
            ) : (
              "Reading memory…"
            )}
          </div>
        )}
        {answer && sources && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Answer to: {mentionsAsText(answer.question)}
            </p>
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <Response text={answer.text} wikiLinks={wikiLinks} />
            </div>
            <SourceChips label="Cited" sources={sources.cited} tone="info" />
            <SourceChips label="Also considered" sources={sources.considered} />
            <p className="text-xs">
              <Link to="/chat/{-$chatId}" params={{ chatId: answer.chatId }} className="underline">
                Continue in chat
              </Link>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SourceChips({
  label,
  sources,
  tone,
}: {
  label: string;
  sources: Source[];
  tone?: "info";
}) {
  if (!sources.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      {sources.map((s) => (
        <Link key={s.slug} to="/memory/$slug" params={{ slug: s.slug }} className="rounded-full">
          <Badge tone={tone ?? "neutral"}>{s.title}</Badge>
        </Link>
      ))}
    </p>
  );
}
