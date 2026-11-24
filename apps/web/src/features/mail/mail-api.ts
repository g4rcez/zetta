import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { serverOrigin } from "@/lib/server-origin";
import { ApiError, call, errorMessage, sendSealed, toApiError } from "../chat/chat-client";

/** What `GET /api/mailboxes` answers (apps/server/src/modules/mail/service.ts, `MailboxView`). Never a password. */
export type MailboxState = "active" | "needs_auth" | "error" | "retired";
export type MailSecurity = "tls" | "starttls";
export type MailServers = {
  imapHost?: string;
  imapPort?: number;
  imapSecurity?: MailSecurity;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: MailSecurity;
  user?: string;
};
export type Sending = "on" | "off";
export type Mailbox = {
  id: string;
  kind: "imap" | "google" | "microsoft" | "provisioned";
  address: string;
  label: string;
  state: MailboxState;
  lastError: string | null;
  sending: Sending;
  ownerBotId: string | null;
  /** Addresses or `@domains` allowed to write to the owner bot. Only a bot's own address uses it. */
  allowedSenders: string[];
  servers: MailServers;
};

export type MailAddress = { name: string; address: string };
export type ConversationSummary = {
  id: string;
  subject: string;
  participants: MailAddress[];
  lastDate: string;
  messageCount: number;
  snippet: string;
  attachments: "none" | "some";
};
export type ConversationPage = { conversations: ConversationSummary[]; nextCursor?: string };

export type Attachment = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  disposition: "attachment" | "inline";
};
export type RemoteImages = "none" | "removed" | "shown";
export type Message = {
  id: string;
  origin: "received" | "sent";
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  date: string | null;
  subject: string;
  text: string;
  /** Already cleaned by the server's allow list. Still shown only inside the sandboxed frame. */
  html: string;
  htmlSize: "ok" | "too_large";
  remoteImages: RemoteImages;
  attachments: Attachment[];
  source: "complete" | "truncated" | "unreadable";
};
export type Conversation = { id: string; subject: string; messages: Message[] };

/** `blocked`: remote images are removed by the server. `remote`: https images are kept. */
export type ImageMode = "blocked" | "remote";

export type DetectStatus = "known" | "dns" | "google" | "microsoft" | "unknown" | "invalid";
export type ServerSuggestion = { host: string; port: number; security: MailSecurity };
export type Detection = {
  status: DetectStatus;
  message: string;
  provider?: { id: string; label: string };
  imap?: ServerSuggestion;
  smtp?: ServerSuggestion;
  user?: string;
  appPasswordUrl?: string;
  confidence?: "checked" | "unchecked";
  /** A Microsoft address: its mailbox when the account is already connected, or the plugin that connects it. */
  next?: { type: "mailbox"; mailboxId: string } | { type: "plugin"; pluginId: string };
};

/** The servers of a connect or edit request, as the server's schema names them. */
export type ServerFields = {
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  user: string;
};
export type ConnectInput = ServerFields & {
  address: string;
  label?: string;
  password: string;
  /** The bot that owns the mailbox; left out, the Chief reads it. */
  botId?: string;
};
export type MailboxPatch = Partial<ServerFields> & {
  label?: string;
  botId?: string | null;
  sending?: Sending;
  allowedSenders?: string[];
};

const path = (id: string, ...rest: string[]) =>
  ["/api/mailboxes", encodeURIComponent(id), ...rest].join("/");
const encode = (v: string) => encodeURIComponent(v);

/** The person's chat with the bot that owns a mailbox (their Chief when none does), made on first use. */
export type MailChat = { conversationId: string; botId: string; botKind: "chief" | "specialist" };

export const mailQueries = {
  /** Asking for it makes the chat when there is none, and is the same answer every time after. The owner is part of the key: a new owner gets a new chat. */
  chat: (mailboxId: string, ownerBotId: string | null) =>
    queryOptions({
      queryKey: ["mail-chat", mailboxId, ownerBotId ?? "none"],
      queryFn: async () => (await call<{ chat: MailChat }>(path(mailboxId, "chat"), "POST")).chat,
      staleTime: Infinity,
      retry: false,
    }),
  /** Whether this server hands out e-mail addresses to bots, and on which domain. Nothing secret. */
  provisioning: () =>
    queryOptions({
      queryKey: ["mail", "provisioning"],
      queryFn: () => call<{ on: boolean; domain: string }>("/api/mail/provisioning"),
      staleTime: 60_000,
    }),
  mailboxes: () =>
    queryOptions({
      queryKey: ["mail", "mailboxes"],
      queryFn: async () => (await call<{ mailboxes: Mailbox[] }>("/api/mailboxes")).mailboxes,
    }),
  /** One page of conversations, then the next from the server's cursor. A search is a different list, so `q` is part of the key. */
  conversations: (mailboxId: string, q: string | undefined) =>
    infiniteQueryOptions({
      queryKey: ["mail", mailboxId, "conversations", q ?? ""],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => {
        const query = new URLSearchParams();
        if (q) query.set("q", q);
        if (pageParam) query.set("cursor", pageParam);
        const tail = query.size ? `?${query}` : "";
        return call<ConversationPage>(`${path(mailboxId, "conversations")}${tail}`);
      },
      getNextPageParam: (last: ConversationPage) => last.nextCursor,
      // Every read reaches a mail server: an answer that is a refusal is not asked again by itself.
      retry: false,
      staleTime: 30_000,
    }),
  conversation: (mailboxId: string, conversationId: string, images: ImageMode) =>
    queryOptions({
      queryKey: ["mail", mailboxId, "conversation", conversationId, images],
      queryFn: async () =>
        (
          await call<{ conversation: Conversation }>(
            `${path(mailboxId, "conversations", encode(conversationId))}?images=${images}`,
          )
        ).conversation,
      retry: false,
      staleTime: 30_000,
    }),
};

export const mailApi = {
  detect: async (address: string) =>
    (await call<{ detection: Detection }>(`/api/mail/detect?address=${encode(address)}`)).detection,

  /** The password is sealed to the server's key in the browser (purpose `mailbox.connect`): it never appears in the request body. */
  connect: async (input: ConnectInput) => {
    const { password, ...rest } = input;
    return (
      await sendSealed("mailbox.connect", { password }, (sealed) =>
        call<{ mailbox: Mailbox }>("/api/mailboxes", "POST", { ...rest, sealed }),
      )
    ).mailbox;
  },

  /** A new password is sealed for this mailbox (purpose `mailbox.password:<id>`); without one the saved password is used. */
  update: async (id: string, patch: MailboxPatch, password?: string) => {
    const send = (sealed?: object) =>
      call<{ mailbox: Mailbox }>(path(id), "PATCH", { ...patch, ...(sealed ? { sealed } : {}) });
    const r = password
      ? await sendSealed(`mailbox.password:${id}`, { password }, (sealed) => send(sealed))
      : await send();
    return r.mailbox;
  },

  /** Removing a Google mailbox hides it (the account stays connected in the Google plugin); a Google account that is connected shows up by itself, and this brings back one that was removed. */
  showGoogle: async (address: string) =>
    (await call<{ mailbox: Mailbox }>("/api/mailboxes/google", "POST", { address })).mailbox,

  /** The same for an Outlook.com or Microsoft 365 account connected in the Microsoft plugin. */
  showMicrosoft: async (address: string) =>
    (await call<{ mailbox: Mailbox }>("/api/mailboxes/microsoft", "POST", { address })).mailbox,

  remove: (id: string) => call<{ ok: true }>(path(id), "DELETE"),

  /** "Give this bot an address": one address per bot, made when the installation offers them. */
  provision: async (botId: string) =>
    (await call<{ mailbox: Mailbox }>("/api/mailboxes/provision", "POST", { botId })).mailbox,

  /** Reads the file and hands it to the browser as a download. A failure throws an `ApiError` with a sentence for the person. */
  async downloadAttachment(mailboxId: string, conversationId: string, a: Attachment) {
    const response = await fetch(
      new URL(
        path(mailboxId, "conversations", encode(conversationId), "attachments", encode(a.id)),
        serverOrigin(),
      ),
      { credentials: "include", cache: "no-cache" },
    );
    if (!response.ok) throw await toApiError(response);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = a.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    // The browser has started the save by now; the address is not needed again.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

/** What a failed read tells the person. The server's sentence is already safe to show. */
export type Failure =
  | { kind: "needs_auth"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "error"; message: string };

export function describeFailure(error: unknown): Failure {
  const message = errorMessage(error);
  if (error instanceof ApiError) {
    if (error.code === "AUTH" || error.code === "NO_PASSWORD")
      return { kind: "needs_auth", message };
    if (error.code === "RATE_LIMITED" || error.status === 429)
      return { kind: "rate_limited", message };
    if (error.status === 404) return { kind: "not_found", message };
  }
  return { kind: "error", message };
}
