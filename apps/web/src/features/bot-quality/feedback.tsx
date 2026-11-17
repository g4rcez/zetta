import { ThumbsDownIcon, ThumbsUpIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { ActionHint } from "@/components/action-hint";
import { Button, Dropdown } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import type { Row } from "../chat/chat-rows";
import { MentionTextarea } from "../chat/mention";
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
 * The thumbs of the message toolbar: a good answer, or a bad one with an optional note on what went wrong. Pressing the thumb that is
 * already chosen takes the rating back. A bad answer on a bot that learns from its work may teach it (see docs/decisions/bot-improvement.md).
 */
export function RateButtons({ row }: { row: Row }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  if (!feedback || !rateable(row)) return null;
  const mine = feedback.ratings[row.id];
  const run = (work: () => Promise<void>) => {
    setError(undefined);
    work().catch((e) => setError(errorMessage(e)));
  };
  return (
    <>
      <ActionHint label="Good answer">
        <Button
          size="icon-xs"
          variant={mine?.rating === "up" ? "secondary" : "ghost"}
          aria-label="Good answer"
          aria-pressed={mine?.rating === "up"}
          onClick={() =>
            run(() =>
              mine?.rating === "up" ? feedback.clear(row.id) : feedback.rate(row.id, "up"),
            )
          }
        >
          <ThumbsUpIcon weight={mine?.rating === "up" ? "fill" : "regular"} />
        </Button>
      </ActionHint>
      <Dropdown
        asChild
        open={open}
        onChange={(next) => {
          setOpen(next);
          if (next) setNote(mine?.rating === "down" ? mine.reason : "");
        }}
        aria-label="Bad answer"
        trigger={
          <ActionHint label="Bad answer">
            <Button
              size="icon-xs"
              variant={mine?.rating === "down" ? "secondary" : "ghost"}
              aria-label="Bad answer"
              aria-pressed={mine?.rating === "down"}
              onClick={() => {
                if (mine?.rating !== "down") run(() => feedback.rate(row.id, "down"));
              }}
            >
              <ThumbsDownIcon weight={mine?.rating === "down" ? "fill" : "regular"} />
            </Button>
          </ActionHint>
        }
      >
        <form
          className="w-72 space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await feedback.rate(row.id, "down", note.trim());
              setOpen(false);
            });
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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                run(async () => {
                  await feedback.clear(row.id);
                  setOpen(false);
                })
              }
            >
              Take it back
            </Button>
            <Button type="submit" size="sm">
              Save note
            </Button>
          </div>
        </form>
      </Dropdown>
    </>
  );
}
