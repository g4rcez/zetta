import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { XIcon } from "@phosphor-icons/react";

import { Skeleton } from "@g4rcez/components";
import { ActionHint } from "@/components/action-hint";
import { BotIdentity } from "@/components/bot-identity";
import { Button } from "@/components/ui";
import { botRole } from "@zetta/core/bot-role";
import { cn } from "@zetta/ui/lib/utils";
import { chatQueries } from "../chat/chat-queries";
import { EmbeddedChat } from "../chat/embedded-chat";
import { describeFailure, mailQueries, type Mailbox } from "./mail-api";

const NO_BOTS: never[] = [];
const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const WITH_CONVERSATION = [
  "Summarise this conversation",
  "What does this person want from me?",
  "Reply that …",
  "Find mail about …",
];
const WITHOUT_CONVERSATION = [
  "Find mail about …",
  "Which conversations are waiting for an answer?",
];

/** Says which conversation "this" means. The subject is shown as text; the bot gets the ids and reads the mail itself. */
function ContextLine({ subject }: { subject: string | undefined }) {
  return (
    <p
      role="status"
      className="truncate rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
    >
      Asking about: <span className="text-foreground">“{subject || "this conversation"}”</span>
    </p>
  );
}

/**
 * The chat of a mailbox beside its inbox: the person talks to the bot that owns the mailbox, or to Zetta when none does. While a
 * conversation is open it is sent with every message, so "this" has a meaning; with none open nothing is sent.
 */
export function MailChatPanel({
  mailbox,
  conversationId,
  action,
}: {
  mailbox: Mailbox;
  /** The open mail conversation, if any. */
  conversationId: string | undefined;
  /** Closes the panel, or goes back to the mail, depending on the screen. */
  action: { label: string; onClick: () => void; icon: "close" | "text" };
}) {
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const chat = useQuery(mailQueries.chat(mailbox.id, mailbox.ownerBotId));
  const open = useQuery({
    ...mailQueries.conversation(mailbox.id, conversationId ?? "", "blocked"),
    enabled: Boolean(conversationId),
  });
  const answering = mailbox.ownerBotId
    ? bots.find((b) => b.id === mailbox.ownerBotId)
    : bots.find((b) => b.kind === "chief");
  let body;
  if (chat.isError)
    body = (
      <div role="alert" className="space-y-3 p-4 text-sm">
        <p>{describeFailure(chat.error).message}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void chat.refetch()}>
          Try again
        </Button>
      </div>
    );
  else if (!chat.data || !answering)
    body = (
      <div role="status" aria-label="Opening the chat" className="space-y-3 p-4">
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  else
    body = (
      <EmbeddedChat
        key={chat.data.conversationId}
        conversationId={chat.data.conversationId}
        bot={answering}
        bots={bots}
        label="Chat about this mailbox"
        context={
          conversationId ? { kind: "mail", mailboxId: mailbox.id, conversationId } : undefined
        }
        contextNote={conversationId ? <ContextLine subject={open.data?.subject} /> : null}
        emptyText={
          conversationId
            ? "Ask about the conversation you have open, or search this mailbox. The bot can answer it when you ask, for example “Reply that …”. Anything it wants to send on its own asks you first."
            : "Ask about this mailbox, or open a conversation and ask about it. The bot can answer mail when you ask. Anything it wants to send on its own asks you first."
        }
        examples={conversationId ? WITH_CONVERSATION : WITHOUT_CONVERSATION}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          {answering ? (
            <BotIdentity
              bot={answering}
              size={28}
              sub={
                mailbox.ownerBotId ? botRole(answering) : "Answers because no bot owns this mailbox"
              }
            />
          ) : (
            <p className="text-sm font-medium">Chat</p>
          )}
          <Link
            to="/mail/$mailboxId/settings"
            params={{ mailboxId: mailbox.id }}
            className={cn(
              "mt-0.5 inline-block rounded-sm text-xs text-primary underline",
              focusRing,
            )}
          >
            Change who answers
          </Link>
        </div>
        {action.icon === "close" ? (
          <ActionHint label={action.label} side="bottom">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={action.label}
              onClick={action.onClick}
            >
              <XIcon aria-hidden="true" className="size-4" />
            </Button>
          </ActionHint>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
