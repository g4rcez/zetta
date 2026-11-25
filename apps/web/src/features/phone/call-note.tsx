import { PhoneIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import type { MessageMeta } from "../chat/chat-client";

type Phone = NonNullable<NonNullable<MessageMeta>["phone"]>;

/** The server's own lines of the message: the headline, what the other party said (retold), and the link line the page replaces with a router link. */
export function callNoteParts(content: string) {
  const lines = content.split("\n").filter(Boolean);
  const link = lines.findIndex((l) => l.startsWith("[Open the call]("));
  const rest = link >= 0 ? lines.filter((_, i) => i !== link) : lines;
  return { headline: rest[0] ?? "", summary: rest.slice(1).join("\n") };
}

/**
 * The outcome of a call a bot placed, in the chat that asked for it: one short note, the summary (written by the bot from what the other
 * party said, so shown as plain text and never followed) and a link to the call's own chat, where the whole exchange is.
 */
export function PhoneCallNote({ content, phone }: { content: string; phone: Phone }) {
  const { headline, summary } = callNoteParts(content);
  return (
    <div role="note" aria-label="Phone call outcome" className="chat-gutter my-2">
      <div className="mx-auto max-w-xl space-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <PhoneIcon aria-hidden="true" className="flex-none text-muted-foreground" />
          <span className="min-w-0 break-words">{headline.replace(/^📞\s*/, "")}</span>
        </div>
        {summary && (
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{summary}</p>
        )}
        {phone.conversationId && (
          <Link
            to="/chat/{-$chatId}"
            params={{ chatId: phone.conversationId }}
            className="link text-xs underline"
          >
            Open the call
          </Link>
        )}
      </div>
    </div>
  );
}
