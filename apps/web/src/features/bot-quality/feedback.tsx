import { ThumbsDownIcon, ThumbsUpIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { toast } from "@/lib/notify";
import { errorMessage } from "../chat/chat-client";
import type { Row } from "../chat/chat-rows";
import { MentionTextarea } from "../chat/mention";
import { MenuRow } from "../chat/menu-row";
import { qualityApi, qualityQueries, type Rating, type Ratings } from "./bot-quality-api";

type FeedbackState = {
  ratings: Ratings;
  rate: (messageId: string, rating: Rating, reason?: string) => Promise<void>;
  clear: (messageId: string) => Promise<void>;
};
const FeedbackContext = createContext<FeedbackState | undefined>(undefined);

/** Thumbs on the bot's replies of one chat. Without this around a log (rooms, threads, interviews) the replies carry no thumbs. */
export function FeedbackProvider({
  conversationId,
  children,
}: {
  conversationId: string | undefined;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    ...qualityQueries.ratings(conversationId ?? ""),
    enabled: Boolean(conversationId),
  });
  const key = qualityQueries.ratings(conversationId ?? "").queryKey;
  const value = useMemo<FeedbackState | undefined>(() => {
    if (!conversationId) return undefined;
    return {
      ratings: query.data ?? {},
      async rate(messageId, rating, reason = "") {
        // Shown at once; the server's answer (or the next refetch) is the truth.
        qc.setQueryData<Ratings>(key, (old) => ({ ...old, [messageId]: { rating, reason } }));
        try {
          await qualityApi.rate(messageId, rating, reason);
        } catch (e) {
          await qc.invalidateQueries({ queryKey: key });
          throw e;
        }
      },
      async clear(messageId) {
        qc.setQueryData<Ratings>(key, (old) => {
          const { [messageId]: _gone, ...rest } = old ?? {};
          return rest;
        });
        try {
          await qualityApi.clearRating(messageId);
        } catch (e) {
          await qc.invalidateQueries({ queryKey: key });
          throw e;
        }
      },
    };
  }, [conversationId, query.data, qc, key]);
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

/** Undefined where no chat provides thumbs. */
export const useFeedback = () => useContext(FeedbackContext);

/** Only a finished answer of a bot can be rated. */
export const rateable = (row: Row) =>
  row.role === "assistant" && Boolean(row.botId) && row.status === "complete" && !row.streaming;

/**
 * The ratings in a message's menu: a good answer, or a bad one. Choosing the good one again takes the rating back. A bad answer is saved at
 * once and then offers a note on what went wrong (`onNote` shows it). A bad answer on a bot that learns from its work may teach it
 * (see docs/decisions/bot-improvement.md).
 */
export function RateRows({
  row,
  onDone,
  onNote,
}: {
  row: Row;
  onDone: () => void;
  onNote: () => void;
}) {
  const feedback = useFeedback();
  if (!feedback || !rateable(row)) return null;
  const mine = feedback.ratings[row.id]?.rating;
  const run = (work: Promise<void>) => void work.catch((e) => toast.error(errorMessage(e)));
  return (
    <>
      <MenuRow
        icon={ThumbsUpIcon}
        pressed={mine === "up"}
        onClick={() => {
          onDone();
          run(mine === "up" ? feedback.clear(row.id) : feedback.rate(row.id, "up"));
        }}
      >
        Good answer
      </MenuRow>
      <MenuRow
        icon={ThumbsDownIcon}
        pressed={mine === "down"}
        onClick={() => {
          if (mine !== "down") run(feedback.rate(row.id, "down"));
          onNote();
        }}
      >
        Bad answer
      </MenuRow>
    </>
  );
}

/** What went wrong with an answer rated bad: an optional note, or taking the rating back. */
export function RatingNote({ row, onDone }: { row: Row; onDone: () => void }) {
  const feedback = useFeedback();
  const [note, setNote] = useState(() => feedback?.ratings[row.id]?.reason ?? "");
  const [error, setError] = useState<string>();
  if (!feedback) return null;
  const run = (work: Promise<void>) => {
    setError(undefined);
    work.then(onDone, (e) => setError(errorMessage(e)));
  };
  return (
    <form
      className="w-72 space-y-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(feedback.rate(row.id, "down", note.trim()));
      }}
    >
      <MentionTextarea
        title="What went wrong? (optional)"
        bots={[]}
        rows={3}
        maxLength={500}
        value={note}
        onChange={setNote}
        placeholder="Too long, wrong tone, missed the point…"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => run(feedback.clear(row.id))}>
          Take it back
        </Button>
        <Button type="submit" size="sm">
          Save note
        </Button>
      </div>
    </form>
  );
}
