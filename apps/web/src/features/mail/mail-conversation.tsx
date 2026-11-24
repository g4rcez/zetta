import { PaperclipIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@g4rcez/components";
import { ActionHint } from "@/components/action-hint";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";
import { errorMessage } from "../chat/chat-client";
import { relativeTime } from "../shared/relative-time";
import {
  describeFailure,
  mailApi,
  mailQueries,
  type Attachment,
  type ImageMode,
  type MailAddress,
  type Message,
} from "./mail-api";
import { ImagesBar, MessageBody } from "./mail-body";
import { ReadFailure } from "./mail-states";

export const person = (a: MailAddress | null) => (a ? a.name || a.address : "Unknown sender");
const people = (list: MailAddress[]) =>
  list
    .map((a) => (a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address))
    .join(", ");

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

/** A file of the message. It downloads on a click; a failure is told next to the file, not by the browser. */
function AttachmentChip({
  mailboxId,
  conversationId,
  attachment,
}: {
  mailboxId: string;
  conversationId: string;
  attachment: Attachment;
}) {
  const [state, setState] = useState<
    { kind: "idle" | "busy" } | { kind: "failed"; message: string }
  >({
    kind: "idle",
  });
  async function download() {
    setState({ kind: "busy" });
    try {
      await mailApi.downloadAttachment(mailboxId, conversationId, attachment);
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "failed", message: errorMessage(e) });
    }
  }
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        disabled={state.kind === "busy"}
        onClick={() => void download()}
        className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-md border border-field px-2.5 py-1 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
      >
        <PaperclipIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{attachment.fileName}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {size(attachment.size)}
        </span>
      </button>
      {state.kind === "failed" && (
        <p role="alert" className="text-xs text-destructive">
          {attachment.fileName} could not be downloaded. {state.message}
        </p>
      )}
    </li>
  );
}

function MessageCard({
  mailboxId,
  conversationId,
  message,
  images,
  onLoadImages,
  loadingImages,
}: {
  mailboxId: string;
  conversationId: string;
  message: Message;
  images: ImageMode;
  onLoadImages: () => void;
  loadingImages: boolean;
}) {
  const tf = useTimeFormat();
  const files = message.attachments.filter((a) => a.disposition === "attachment");
  return (
    <article className="space-y-3 py-4">
      <header className="space-y-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="min-w-0 text-sm font-medium break-words">
            {person(message.from)}
            {message.from?.name && (
              <span className="font-normal [overflow-wrap:anywhere] text-muted-foreground">
                {" "}
                {message.from.address}
              </span>
            )}
          </p>
          {message.date && (
            <ActionHint label={formatDateTime(message.date, tf)} side="bottom">
              <time
                dateTime={message.date}
                tabIndex={0}
                className="rounded-sm text-xs text-muted-foreground tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {relativeTime(message.date)}
              </time>
            </ActionHint>
          )}
        </div>
        {message.to.length > 0 && (
          <p className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
            To: {people(message.to)}
          </p>
        )}
        {message.cc.length > 0 && (
          <p className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
            Cc: {people(message.cc)}
          </p>
        )}
        {message.origin === "sent" && (
          <p className="text-xs text-muted-foreground">Sent from this mailbox</p>
        )}
      </header>
      {message.remoteImages === "removed" && images === "blocked" && (
        <ImagesBar onLoad={onLoadImages} loading={loadingImages} />
      )}
      <MessageBody message={message} images={images} />
      {files.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2">
          {files.map((a) => (
            <AttachmentChip
              key={a.id}
              mailboxId={mailboxId}
              conversationId={conversationId}
              attachment={a}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * The open conversation: every message, oldest first as the server sends them. "Load images" is for this conversation only and is not
 * remembered: the page is keyed by the conversation, so opening another starts with the images blocked again.
 */
export function ConversationPane({
  mailboxId,
  conversationId,
}: {
  mailboxId: string;
  conversationId: string;
}) {
  const [images, setImages] = useState<ImageMode>("blocked");
  const query = useQuery({
    ...mailQueries.conversation(mailboxId, conversationId, images),
    // Loading the images asks again; the messages stay on screen meanwhile.
    placeholderData: (previous) => previous,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // After the person picks another conversation, the heading takes the focus: a screen reader announces it, and on a phone the view starts at the top.
  useEffect(() => {
    if (first.current) first.current = false;
    else if (query.data) heading.current?.focus();
  }, [conversationId, query.data?.id]);

  if (query.isPending)
    return (
      <div role="status" aria-label="Loading the conversation" className="space-y-3 p-6">
        <Skeleton className="h-6 w-2/3 rounded" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  if (query.isError)
    return (
      <ReadFailure
        failure={describeFailure(query.error)}
        mailboxId={mailboxId}
        what="this conversation"
        onRetry={() => void query.refetch()}
      />
    );
  const c = query.data;
  return (
    <section
      aria-labelledby="conversation-title"
      className="mx-auto w-full max-w-4xl px-4 pb-8 md:px-6"
    >
      <h2
        id="conversation-title"
        ref={heading}
        tabIndex={-1}
        className="pt-4 text-lg font-medium text-balance break-words outline-none"
      >
        {c.subject || "(no subject)"}
      </h2>
      <p role="status" className="sr-only">
        Conversation: {c.subject || "no subject"}, {c.messages.length}{" "}
        {c.messages.length === 1 ? "message" : "messages"}
      </p>
      <div className="divide-y">
        {c.messages.map((m) => (
          <MessageCard
            key={m.id}
            mailboxId={mailboxId}
            conversationId={conversationId}
            message={m}
            images={images}
            loadingImages={query.isPlaceholderData}
            onLoadImages={() => setImages("remote")}
          />
        ))}
      </div>
    </section>
  );
}
