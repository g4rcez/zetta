/**
 * When a bot's mail goes out at once and when it waits for the person. Pure: the chat service gathers the facts, and nothing here is a
 * rule written in a prompt for the model to obey. A mail sent in a person's name cannot be taken back, so the server decides.
 *
 * The rule: the person's own request in this turn is the approval. Everything else is a card (the exact mail, one Approve click), and a
 * few cases are refused outright. `send` (no card) needs ALL of these:
 *   a. the turn is the person's own message in their own chat with the bot (never a loop step, a routine or any turn Zetta started);
 *   b. the person's own words in this turn ask for mail to be sent (`asksToSendMail`, on their message only, never on mail text, tool
 *      results or the bot's words);
 *   c. the recipients are ones the person pointed at: a reply goes to the author of a message of the conversation open next to the
 *      chat (an id the server resolved, never one the bot chose); a new mail goes only to addresses the person wrote in their own
 *      message or to correspondents of that open conversation;
 *   d. the only outside content the turn read is that open conversation. Any other conversation, a search, a page, a file or another
 *      plugin's data that the server saw turns it into a card, so a hostile mail cannot make the bot carry other mail back to its sender.
 *      What the server cannot see (a bot with code access or MCP servers reads files and pages inside its own tools) is not counted:
 *      the same trade-off `writeMode` makes (approval-policy.ts), kept visible in docs/security/plan.md as an accepted risk.
 * There is no "always allow" for sending mail (a card of a paused plugin call is never remembered: approval-rules.ts).
 */
import type { MailAccess } from "../mail/access";
import type { MailContext } from "../mail/context";
import type { PluginTurn } from "../integrations/plugins/turn";

export type MailSendMode = "send" | "card" | "refuse";

/** Why a send is refused, as a closed code. The plugin turns each into a sentence for the bot and the person. */
export type MailRefusal =
  | "not_here"
  | "no_access"
  | "needs_auth"
  | "not_active"
  | "sending_off"
  | "turn_limit"
  | "rate_limit";

/** What the chat service knows about the turn, once per round. */
export type MailTurnFacts = {
  /** Where the turn runs (plugins/turn.ts). Only "chat" can send without a card. */
  place: PluginTurn | undefined;
  /** The person's own words this turn: their message and what they added while the bot worked. Nothing else. */
  personText: string;
  /** The turn read outside content other than the open conversation (or started with some: a file, an event payload). */
  readElsewhere: boolean;
  /** Sends and cards already made this turn. */
  attempts: number;
  /** The mail conversation open next to the chat, as the server resolved it. */
  open: MailContext | undefined;
};

/** What the tool knows about this one send. */
export type MailCall = {
  tool: "mail_reply" | "mail_send";
  mailbox: { id: string; sending: "on" | "off"; state: string };
  access: MailAccess;
  /** The mailbox's send limiter would refuse right now. */
  rate: "ok" | "limited";
  /** Plain addresses, lower case. */
  to: string[];
  /** mail_reply: the conversation being answered. */
  conversationId?: string;
  /**
   * mail_reply: the people who wrote the conversation (not the mailbox's owner). mail_send: the correspondents of the open conversation
   * when it is of this mailbox. Lower case.
   */
  authors: string[];
  /** mail_reply: the recipient came from a Reply-To that is not the sender's own address. */
  replyToDiffers?: boolean;
};

export type MailSendDecision = { mode: MailSendMode; reason?: MailRefusal | undefined };

/** The tools' own limits. */
export const MAIL_SEND_LIMITS = {
  perTurn: 3,
  recipients: 5,
  subject: 200,
  text: 10_000,
  perMinute: 5,
  perHour: 20,
} as const;

const REFUSAL_FOR: Record<MailAccess, MailRefusal | undefined> = {
  read: undefined,
  needs_auth: "needs_auth",
  denied: "no_access",
};

/** The reasons a send must not run at all. They need no recipient, so the tool asks before it reads any mail. */
export function mailRefusal(t: MailTurnFacts, c: Pick<MailCall, "access" | "mailbox" | "rate">) {
  if (t.place !== "chat" && t.place !== "loop" && t.place !== "server") return "not_here" as const;
  const access = REFUSAL_FOR[c.access];
  if (access) return access;
  if (c.mailbox.state !== "active") return "not_active" as const;
  if (c.mailbox.sending !== "on") return "sending_off" as const;
  if (t.attempts >= MAIL_SEND_LIMITS.perTurn) return "turn_limit" as const;
  if (c.rate === "limited") return "rate_limit" as const;
  return undefined;
}

/** Whether an address is written in the person's words, as a whole address (not inside a longer one). */
export function namedIn(text: string, address: string): boolean {
  if (!address) return false;
  const esc = address.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.%+-])${esc}(?![\\w%+-]|\\.\\w)`).test(text.toLowerCase());
}

/** The recipients are ones the person pointed at (point c). */
export function recipientsPointed(t: MailTurnFacts, c: MailCall): boolean {
  if (!c.to.length) return false;
  const open = t.open;
  const here = open?.mailboxId === c.mailbox.id;
  if (c.tool === "mail_reply") {
    return (
      here &&
      open!.conversationId === c.conversationId &&
      c.to.length === 1 &&
      !c.replyToDiffers &&
      c.authors.includes(c.to[0]!)
    );
  }
  return c.to.every(
    (a) => namedIn(t.personText, a) || (here && c.authors.includes(a.toLowerCase())),
  );
}

export function mailSendMode(t: MailTurnFacts, c: MailCall): MailSendDecision {
  const reason = mailRefusal(t, c);
  if (reason) return { mode: "refuse", reason };
  if (t.place !== "chat") return { mode: "card" };
  if (!asksToSendMail(t.personText)) return { mode: "card" };
  if (t.readElsewhere) return { mode: "card" };
  if (!recipientsPointed(t, c)) return { mode: "card" };
  return { mode: "send" };
}

/** What the tool is handed by the chat service. The turn facts stay on the server side of this object. */
export type MailGate = {
  /** The conversation open next to the chat (ids the server resolved), so a tool can read who wrote it. */
  open: MailContext | undefined;
  decide(call: MailCall): MailSendDecision;
  /** Early check with no recipient yet: a refusal or undefined. Counts nothing. */
  refusal(call: Pick<MailCall, "access" | "mailbox" | "rate">): MailRefusal | undefined;
  /** A send or a card was made: it counts against the per-turn limit. */
  record(): void;
};

/** The gate over the facts of one turn. `t` is the turn's own record: `record` and the readers of `readElsewhere` change it in place. */
export const gateFor = (t: MailTurnFacts): MailGate => ({
  open: t.open,
  decide: (c) => mailSendMode(t, c),
  refusal: (c) => mailRefusal(t, c),
  record: () => void (t.attempts += 1),
});

/** A gate for a call with no turn information (a test, a direct call): it never sends without a card. */
export const cardOnlyGate = (place: PluginTurn | undefined): MailGate =>
  gateFor({
    place,
    personText: "",
    readElsewhere: true,
    attempts: 0,
    open: undefined,
  });

/**
 * Does a call read outside content (anything but the open conversation, the list of the person's own mailboxes and the server's own
 * receipts of a send)? The ledger of the turn (`readElsewhere`) is set by it, call by call, so a send that follows a read in the same
 * round sees it. The mailbox is matched by id, as the server's own line hands it to the bot; an address counts as another place.
 */
export function readsElsewhere(
  c: { kind: string; args: unknown },
  open: MailContext | undefined,
): boolean {
  if (c.kind !== "plugin") return true;
  const a = (c.args ?? {}) as { plugin?: unknown; tool?: unknown; args?: unknown };
  if (a.plugin !== "mailbox") return true;
  const inner = (a.args && typeof a.args === "object" ? a.args : {}) as Record<string, unknown>;
  switch (a.tool) {
    case "mailbox_list":
    case "mail_send":
      return false;
    case "mail_reply":
      return false;
    case "mail_read":
      return !(
        open &&
        inner.mailbox === open.mailboxId &&
        inner.conversation === open.conversationId
      );
    default:
      return true;
  }
}

/* ---------------------------------------------------------------------------------------------------------------------------------
 * Did the person ask for mail to be sent? English, Portuguese and Spanish. Deliberately wide in what it reads as a command and strict
 * in what it lets through: a miss is a card (one click), a false hit would let a bot send in their name. It reads the person's own
 * message only. A question about mail ("did Ana answer?", "what should I reply?"), a draft, a refusal ("don't send") and an answer meant
 * for the person themselves ("tell me", "reply here") are not requests.
 * ------------------------------------------------------------------------------------------------------------------------------- */

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");

/** What a clause may start with before the verb: courtesy and linking words. */
const FILLER =
  "(?:(?:please|pls|plz|kindly|now|then|ok|okay|also|and|just|so|go ahead and|por favor|pf|porfa|agora|entao|depois|e|tambem|vai|ahora|luego|despues|y|tambien|pues)\\b[ ,]*)*";
/** Verbs that send or answer, imperative or infinitive. A noun use ("mail from Ana", "reply from Ana") is not a command. */
const VERB =
  "(?:send|reply|respond|answer|write back|e-?mail|mail|tell|let \\w+ know|get back to|drop \\w+ a (?:line|note)|" +
  "responde|responda|responder|envia|envie|enviar|manda|mande|mandar|escreve|escreva|escrever|avisa|avise|avisar|diz|diga|dize|dizer|" +
  "respondas|envies|mandes|escribas|contestes|avises|digas|contesta|conteste|contestar|escribe|escriba|escribir|dile|decile|digale|decir|enviale|escribele|avisale|mandale|contestale|respondele)" +
  "(?!\\s+(?:from|is|was|has|had|came|will|would|should|can)\\b)";
const COMMAND = new RegExp(`^${FILLER}${VERB}\\b`);
/** "Can you reply…", "pode responder…", "puedes enviar…", "I want you to send…", "quero que voce responda…". */
const POLITE = new RegExp(
  `\\b(?:(?:can|could|would|will) you|(?:i(?:'d| would)? (?:want|need|like)|i'd like) you to|` +
    `pode|poderia|consegue|voce pode|quero que|preciso que|` +
    `puedes|podrias|puede|quiero que|necesito que)(?: voce| please| por favor)*[ ,]*${VERB}\\b`,
);
/** A sentence that is about a draft, a suggestion, a hold or a refusal is not a request to send. */
const NOT_NOW =
  /\b(draft|drafts|rascunho|rascunhos|borrador|borradores|minuta|preview|propose|suggest|suggestion|sugira|sugere|sugiro|sugiere|proponha|propon|do not|don't|dont|never|nao|nunca|no lo|sin|sem|without|wait|hold|espera|aguarde|aguardar|until|before|antes|hasta que|ate eu|ate que|unless|a menos|se eu)\b/;
/** Where the words to send begin: what comes after is the content, not the command. */
const CONTENT =
  /\b(?:that|saying|say|says|telling|dizendo|diciendo)\b|(?<!quero )(?<!preciso )(?<!quiero )(?<!necesito )\bque\b|["\u201c:]/;
/** The answer is meant for the person, not for someone by mail. */
const FOR_ME =
  /\b(me|us|here|myself|aqui|aca|mim|nos|conmigo|comigo|in (?:this )?chat|no chat|en el chat|neste chat|nesse chat)\b/;
const QUESTION_START =
  /^(?:what|how|should|did|do|does|is|are|was|were|why|when|who|which|can i|could i|que|como|devo|deveria|precisa|qual|quem|quando|por que|porque|cual|quien|cuando|debo|deberia|donde)\b/;

/** The clauses of a sentence: a command may follow "and", "then" or a comma ("read it and reply saying…"). */
const clauses = (s: string) =>
  s.split(/\s*(?:[;,]|\b(?:and then|and|then|e depois|depois|y luego|luego)\b)\s*/);

export function asksToSendMail(personText: string): boolean {
  for (const raw of strip(personText).split(/(?<=[.!?\n])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const question = sentence.endsWith("?");
    const head = sentence.split(CONTENT)[0] ?? sentence;
    if (NOT_NOW.test(head) || FOR_ME.test(head)) continue;
    if (POLITE.test(sentence.split(CONTENT)[0] ?? sentence) && !QUESTION_START.test(sentence))
      return true;
    if (question) continue;
    for (const clause of clauses(sentence)) if (COMMAND.test(clause.trim())) return true;
  }
  return false;
}
