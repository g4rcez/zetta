import { uiToText } from "@zetta/render/chat-text";
import { MAIL_SEND_LIMITS } from "../../chat/mail-policy";
import { AccessError, type ActiveActor } from "../../identity/access";
import { MailConnectError } from "../../mail/imap-connect";
import { BOTMAIL_PLUGIN } from "../../mail/poller";
import { MailServiceError, type MailService } from "../../mail/service";
import type { Mailbox } from "../../mail/store";
import { baseSubject } from "../../mail/threading";
import { PluginError, registerPlugin, type PluginDef } from "./registry";
import { senderAllowed } from "./mail";
import { createSendLimit } from "./send-limit";
import { clean, obj, requiredText } from "./untrusted";

/**
 * The reply door of a bot's own address, for the turns an outside person starts by writing to it (modules/mail/poller.ts hands the
 * bot an inbound event; modules/inbound runs the turn). It is what the `mail` plugin gives an outside person and nothing more: one tool,
 * `send_email`, to the address that wrote (the inbound policy in the chat service already refuses any other address), plain text, with
 * a subject and the threading headers the server writes itself. It is offered only in an inbound turn, and only to the bot that owns the
 * address, so the mailbox plugin's reading tools stay shut to outside people.
 */
export type BotMailDeps = {
  mail: Pick<MailService, "send">;
  /** The bot's own provisioned mailbox, or undefined. */
  mailboxOf: (a: ActiveActor, botId: string) => Promise<Mailbox | undefined>;
  /** The newest message the mailbox received from an address. */
  latestFrom: (
    mailboxId: string,
    address: string,
  ) => Promise<{ id: string; subject: string } | undefined>;
  actorFor: (userId: string) => Promise<ActiveActor | null>;
  audit?: (
    userId: string,
    e: { botId: string; subjectId: string; outcome: "ok" | "failed" | "denied"; detail: string },
  ) => void;
};
let deps: BotMailDeps | undefined;
/** Wired once by the server (the registry is built at import time, the services are not). */
export const configureBotMail = (d: BotMailDeps | undefined) => {
  deps = d;
};

const MAX_SEND = MAIL_SEND_LIMITS.text;
const limit = createSendLimit({
  perHour: MAIL_SEND_LIMITS.perHour,
  perMin: MAIL_SEND_LIMITS.perMinute,
});
/** Test helper. */
export const resetBotMailLimits = limit.reset;

/** The mailbox a call may use: the bot's own, active, with someone allowed to write to it. */
async function own(userId: string | undefined, botId: string | undefined) {
  if (!deps || !userId || !botId) return undefined;
  const actor = await deps.actorFor(userId);
  if (!actor) return undefined;
  const box = await deps.mailboxOf(actor, botId);
  if (!box || box.state !== "active" || !box.allowedSenders.length) return undefined;
  return { actor, box };
}

const def: PluginDef = {
  id: BOTMAIL_PLUGIN,
  name: "Bot e-mail address",
  icon: "at",
  category: "messaging",
  kind: "native",
  auth: "none",
  fields: [],
  description:
    "The bot's own e-mail address: people the user allowed write to it, and the bot answers them by e-mail. Nothing else is reachable from there.",
  inbound: {
    label: "E-mail",
    // The mailbox poller stores this channel's mail itself (modules/mail/poller.ts); the platform never polls it through the plugin.
    async poll() {
      return { events: [], cursor: null };
    },
    reply: {
      tool: "send_email",
      chatArg: "to",
      normalize: (c) =>
        String(c ?? "")
          .trim()
          .toLowerCase(),
    },
  },
  tools: [
    {
      name: "send_email",
      description:
        "Answer the person who wrote to your address, by plain text e-mail. `to` is the address of this conversation, as given in the incoming message. The server writes the subject and links the reply to their message. Rate limited.",
      inputSchema: obj(
        {
          to: {
            type: "string",
            description: "The address of the conversation, as given in the incoming message",
          },
          text: { type: "string", description: `The message, max ${MAX_SEND} characters` },
        },
        ["to", "text"],
      ),
      async handler(ctx, args) {
        const mine = await own(ctx.userId, ctx.botId);
        if (!mine || ctx.turn !== "inbound")
          throw new PluginError("NOT_FOUND", "This bot has no address to answer from here.");
        const { actor, box } = mine;
        const text = requiredText(uiToText(String(args.text ?? "")), MAX_SEND);
        const to = String(args.to ?? "")
          .trim()
          .toLowerCase();
        const denied = (detail: string) =>
          deps?.audit?.(actor.userId, {
            botId: ctx.botId!,
            subjectId: box.id,
            outcome: "denied",
            detail: `send_email:${detail}`,
          });
        if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(to) || to.length > 254)
          throw new PluginError("INVALID_ARGS", "to must be one e-mail address.");
        // Only an address the person allowed, and only one that wrote to this address: a reply cannot become mail to somebody else.
        if (!senderAllowed(to, box.allowedSenders)) {
          denied("not_allowed");
          throw new PluginError(
            "NOT_ALLOWED",
            "That address is not on the list of allowed senders, so the bot cannot write to it.",
          );
        }
        const last = await deps!.latestFrom(box.id, to);
        if (!last) {
          denied("no_message");
          throw new PluginError(
            "NOT_ALLOWED",
            "That address has not written to this mailbox, so there is nothing to answer.",
          );
        }
        if (!limit.allow(box.id)) {
          denied("rate");
          throw new PluginError(
            "RATE_LIMITED",
            `The e-mail sending limit was reached (${MAIL_SEND_LIMITS.perMinute} a minute, ${MAIL_SEND_LIMITS.perHour} an hour).`,
            "Wait a few minutes and ask again.",
          );
        }
        const base = clean(baseSubject(last.subject), 160).replace(/\s+/g, " ").trim();
        try {
          await deps!.mail.send(actor, box.id, {
            to: [to],
            subject: `Re: ${base || "your message"}`,
            text,
            inReplyTo: last.id,
          });
        } catch (e) {
          deps?.audit?.(actor.userId, {
            botId: ctx.botId!,
            subjectId: box.id,
            outcome: "failed",
            detail: "send_email:failed",
          });
          if (e instanceof MailConnectError) throw new PluginError(e.code, e.safe, e.fix);
          if (e instanceof MailServiceError) throw new PluginError(`MAIL_${e.code}`, e.message);
          if (e instanceof AccessError)
            throw new PluginError("NOT_FOUND", "There is no such mailbox.");
          throw e;
        }
        deps?.audit?.(actor.userId, {
          botId: ctx.botId!,
          subjectId: box.id,
          outcome: "ok",
          detail: "send_email:sent",
        });
        return { sent: true, to };
      },
    },
  ],
  builtin: true,
  gate: {
    // Offered only while an outside person's mail is being answered, to the bot that owns the address.
    async available(botId, userId, turn) {
      return turn === "inbound" && Boolean(await own(userId, botId));
    },
    refusal: {
      safe: "This bot cannot send e-mail here.",
      fix: "Its address answers only the people the user allowed, in the conversation they started. Do not try again.",
    },
  },
};
export const botMailPlugin = registerPlugin(def);
