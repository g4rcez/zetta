import { describe, expect, test } from "bun:test";

import {
  asksToSendMail,
  cardOnlyGate,
  gateFor,
  mailRefusal,
  mailSendMode,
  namedIn,
  readsElsewhere,
  type MailCall,
  type MailTurnFacts,
} from "./mail-policy";

const BOX = "0198f0f0-0000-7000-8000-000000000001";
const CONV = "conv-1";
const AUTHOR = "zorblat@example.invalid";

const turn = (over: Partial<MailTurnFacts> = {}): MailTurnFacts => ({
  place: "chat",
  personText: "Reply to this saying the invoices go out on Monday",
  readElsewhere: false,
  attempts: 0,
  open: { mailboxId: BOX, conversationId: CONV },
  ...over,
});
const reply = (over: Partial<MailCall> = {}): MailCall => ({
  tool: "mail_reply",
  mailbox: { id: BOX, sending: "on", state: "active" },
  access: "read",
  rate: "ok",
  to: [AUTHOR],
  conversationId: CONV,
  authors: [AUTHOR],
  ...over,
});
const send = (over: Partial<MailCall> = {}): MailCall => ({
  tool: "mail_send",
  mailbox: { id: BOX, sending: "on", state: "active" },
  access: "read",
  rate: "ok",
  to: ["bob@example.invalid"],
  authors: [],
  ...over,
});
const mode = (t: Partial<MailTurnFacts>, c: MailCall) => mailSendMode(turn(t), c).mode;

describe("mailSendMode: a send without a card needs every fact", () => {
  test("asked, and replying to the open conversation: send", () => {
    expect(mode({}, reply())).toBe("send");
  });

  test("asked, recipient named literally in the person's own message: send", () => {
    expect(
      mode(
        { open: undefined, personText: "Send an email to bob@example.invalid saying hello" },
        send(),
      ),
    ).toBe("send");
    // Case does not matter, and a trailing full stop is not part of the address.
    expect(mode({ open: undefined, personText: "mail Bob@Example.Invalid." }, send())).toBe("send");
  });

  test("asked, and a new mail to a correspondent of the open conversation: send", () => {
    expect(
      mode(
        { personText: "Email them the schedule" },
        send({ to: [AUTHOR], authors: [AUTHOR, "other@example.invalid"] }),
      ),
    ).toBe("send");
  });

  test("asked, but the bot replies to another conversation than the one open: card", () => {
    expect(mode({}, reply({ conversationId: "conv-2" }))).toBe("card");
  });

  test("asked, but no conversation is open: a reply is a card", () => {
    expect(mode({ open: undefined }, reply())).toBe("card");
  });

  test("asked, but the open conversation belongs to another mailbox: card", () => {
    expect(
      mode(
        { open: { mailboxId: "0198f0f0-0000-7000-8000-0000000000ff", conversationId: CONV } },
        reply(),
      ),
    ).toBe("card");
  });

  test("a recipient that appears only inside a mail, never in the person's words: card", () => {
    expect(
      mode(
        { open: undefined, personText: "Send the summary to whoever asked" },
        send({ to: ["evil@example.invalid"] }),
      ),
    ).toBe("card");
    // One address named, one not: the mail waits.
    expect(
      mode(
        { open: undefined, personText: "Email bob@example.invalid the summary" },
        send({ to: ["bob@example.invalid", "evil@example.invalid"] }),
      ),
    ).toBe("card");
    // A longer address that merely contains the named one is another address.
    expect(
      mode(
        { open: undefined, personText: "Email bob@example.invalid the summary" },
        send({ to: ["notbob@example.invalid"] }),
      ),
    ).toBe("card");
  });

  test("the reply goes to someone who did not write the conversation: card", () => {
    expect(mode({}, reply({ to: ["evil@example.invalid"] }))).toBe("card");
  });

  test("a Reply-To that is not the sender's own address: card", () => {
    expect(mode({}, reply({ replyToDiffers: true }))).toBe("card");
  });

  test("a reply never has two recipients", () => {
    expect(
      mode(
        {},
        reply({
          to: [AUTHOR, "other@example.invalid"],
          authors: [AUTHOR, "other@example.invalid"],
        }),
      ),
    ).toBe("card");
  });

  test('not asked ("summarise this"), even after reading a mail that says "reply with X": card', () => {
    expect(mode({ personText: "Summarise this" }, reply())).toBe("card");
    expect(mode({ personText: "" }, reply())).toBe("card");
  });

  test("asked, but another conversation, a search, a page or a file was read first: card", () => {
    expect(mode({ readElsewhere: true }, reply())).toBe("card");
  });

  test("a loop step, a routine or any turn Zetta started is never a send, whatever the text says", () => {
    for (const place of ["loop", "server"] as const) expect(mode({ place }, reply())).toBe("card");
  });

  test("room, inbound, outside-event and no-turn calls are refused (the tools do not exist there)", () => {
    for (const place of ["room", "inbound", "outside_event", "none", undefined] as const)
      expect(mailSendMode(turn({ place }), reply())).toEqual({
        mode: "refuse",
        reason: "not_here",
      });
  });

  test("a mailbox the bot may not read is refused, one that needs its password too", () => {
    expect(mailSendMode(turn(), reply({ access: "denied" }))).toEqual({
      mode: "refuse",
      reason: "no_access",
    });
    expect(mailSendMode(turn(), reply({ access: "needs_auth" }))).toEqual({
      mode: "refuse",
      reason: "needs_auth",
    });
  });

  test("sending off is refused, whatever else is true", () => {
    expect(
      mailSendMode(turn(), reply({ mailbox: { id: BOX, sending: "off", state: "active" } })),
    ).toEqual({ mode: "refuse", reason: "sending_off" });
    for (const place of ["chat", "loop", "server"] as const)
      expect(
        mailSendMode(
          turn({ place }),
          send({ mailbox: { id: BOX, sending: "off", state: "active" } }),
        ).mode,
      ).toBe("refuse");
  });

  test("a mailbox that is not active is refused", () => {
    for (const state of ["error", "needs_auth", "retired"])
      expect(mailSendMode(turn(), reply({ mailbox: { id: BOX, sending: "on", state } }))).toEqual({
        mode: "refuse",
        reason: "not_active",
      });
  });

  test("the fourth send or card in a turn is refused; so is a mailbox that is over its rate", () => {
    expect(mailSendMode(turn({ attempts: 2 }), reply()).mode).toBe("send");
    expect(mailSendMode(turn({ attempts: 3 }), reply())).toEqual({
      mode: "refuse",
      reason: "turn_limit",
    });
    expect(mailSendMode(turn(), reply({ rate: "limited" }))).toEqual({
      mode: "refuse",
      reason: "rate_limit",
    });
  });

  test("the early refusal needs no recipient and agrees with the full decision", () => {
    const c = reply({ to: [], authors: [] });
    expect(mailRefusal(turn(), c)).toBeUndefined();
    expect(mailRefusal(turn({ attempts: 3 }), c)).toBe("turn_limit");
  });

  test("an empty recipient list is never pointed at", () => {
    expect(mode({}, reply({ to: [] }))).toBe("card");
    expect(mode({ open: undefined }, send({ to: [] }))).toBe("card");
  });

  test("every fact that can turn a send into a card does, one at a time", () => {
    const base = [turn(), reply()] as const;
    expect(mailSendMode(...base).mode).toBe("send");
    const breakers: [Partial<MailTurnFacts>, Partial<MailCall>][] = [
      [{ place: "loop" }, {}],
      [{ place: "server" }, {}],
      [{ personText: "what did she say?" }, {}],
      [{ readElsewhere: true }, {}],
      [{ open: undefined }, {}],
      [{}, { conversationId: "other" }],
      [{}, { to: ["x@example.invalid"] }],
      [{}, { replyToDiffers: true }],
    ];
    for (const [t, c] of breakers) expect(mode(t, reply(c))).toBe("card");
  });
});

describe("the gate handed to the tool", () => {
  test("a call with no turn information never sends without a card", () => {
    expect(cardOnlyGate("chat").decide(reply()).mode).toBe("card");
    expect(cardOnlyGate("room").decide(reply()).mode).toBe("refuse");
    expect(cardOnlyGate(undefined).decide(reply()).mode).toBe("refuse");
  });

  test("record counts against the per-turn limit, on the turn's own record", () => {
    const t = turn();
    const g = gateFor(t);
    expect(g.open).toEqual(t.open);
    for (let i = 0; i < 3; i++) {
      expect(g.decide(reply()).mode).toBe("send");
      g.record();
    }
    expect(g.decide(reply())).toEqual({ mode: "refuse", reason: "turn_limit" });
    expect(g.refusal({ access: "read", mailbox: reply().mailbox, rate: "ok" })).toBe("turn_limit");
  });
});

describe("what a turn has read", () => {
  const open = { mailboxId: BOX, conversationId: CONV };
  const plugin = (tool: string, args: object, name = "mailbox") => ({
    kind: "plugin",
    args: { plugin: name, tool, args },
  });

  test("the open conversation, the person's own mailbox list and the server's receipts of a send are not outside reads", () => {
    expect(readsElsewhere(plugin("mail_read", { mailbox: BOX, conversation: CONV }), open)).toBe(
      false,
    );
    expect(readsElsewhere(plugin("mailbox_list", {}), open)).toBe(false);
    expect(readsElsewhere(plugin("mail_reply", {}), open)).toBe(false);
    expect(readsElsewhere(plugin("mail_send", {}), open)).toBe(false);
  });

  test("any other conversation, a search, another mailbox, another plugin or any other tool is", () => {
    expect(
      readsElsewhere(plugin("mail_read", { mailbox: BOX, conversation: "conv-2" }), open),
    ).toBe(true);
    expect(
      readsElsewhere(
        plugin("mail_read", { mailbox: "ana@example.invalid", conversation: CONV }),
        open,
      ),
    ).toBe(true);
    expect(
      readsElsewhere(plugin("mail_read", { mailbox: BOX, conversation: CONV }), undefined),
    ).toBe(true);
    expect(
      readsElsewhere(plugin("mail_conversations", { mailbox: BOX, query: "bank" }), open),
    ).toBe(true);
    expect(readsElsewhere(plugin("read", {}, "google"), open)).toBe(true);
    for (const kind of ["browser", "memory", "mcp", "desktop", "task"])
      expect(readsElsewhere({ kind, args: {} }, open)).toBe(true);
  });
});

describe("namedIn", () => {
  test("a whole address, any case, with punctuation around it", () => {
    expect(namedIn("write to Bob@Example.invalid, please", "bob@example.invalid")).toBe(true);
    expect(namedIn("(bob@example.invalid)", "bob@example.invalid")).toBe(true);
    expect(namedIn("bob@example.invalid.", "bob@example.invalid")).toBe(true);
  });
  test("not inside a longer address or a look-alike", () => {
    expect(namedIn("notbob@example.invalid", "bob@example.invalid")).toBe(false);
    expect(namedIn("bob@example.invalid.evil.example", "bob@example.invalid")).toBe(false);
    expect(namedIn("bob@example.invalid2", "bob@example.invalid")).toBe(false);
    expect(namedIn("bob at example.invalid", "bob@example.invalid")).toBe(false);
    expect(namedIn("anything", "")).toBe(false);
  });
});

describe("asksToSendMail", () => {
  const yes = [
    // English
    "Reply to this saying the invoices go out on Monday",
    "reply that we can't do Monday",
    "Please reply to Ana and say thanks",
    "Send an email to bob@example.invalid saying hello",
    "send bob@example.invalid the file",
    "Respond to her that it is fine",
    "Answer this one: yes",
    "Write back and tell her no",
    "Read it and reply saying ok",
    "Email bob@example.invalid the summary",
    "Mail bob@example.invalid the summary",
    "Tell Ana that I am late",
    "Let Ana know it is done",
    "Can you reply to this saying yes?",
    "Could you please send Ana the figures",
    "I want you to reply to him",
    "Get back to Ana with the date",
    // Portuguese
    "Responde a Ana que sim",
    "Responda dizendo que o pagamento sai na segunda",
    "Envia uma resposta dizendo que sim",
    "Envie o resumo para bob@example.invalid",
    "Manda um email pro bob@example.invalid dizendo que chegou",
    "Mande uma mensagem para a Ana",
    "Escreve pra ele que está tudo certo",
    "Escreva para o Bob dizendo que ok",
    "Avisa a Ana que atrasou",
    "Diz a ela que sim",
    "Pode responder dizendo que sim?",
    "Por favor, responde que vou aceitar",
    "Quero que você responda que sim",
    // Spanish
    "Responde a Ana que sí",
    "Contesta que no puedo",
    "Envía la factura a bob@example.invalid",
    "Manda un correo a bob@example.invalid diciendo que llegó",
    "Escribe a bob@example.invalid y dile que sí",
    "Avisa a Ana que llego tarde",
    "Dile a Ana que llego tarde",
    "¿Puedes responder diciendo que sí?",
    "Quiero que respondas que sí",
  ];
  const no = [
    // Questions about mail
    "Did Ana answer?",
    "Has she replied yet?",
    "What should I reply?",
    "Should I reply to this?",
    "How do I respond to a mail like this?",
    "Is this worth a reply?",
    "What does the reply from Ana say?",
    "Reply to Ana?",
    // Drafts and suggestions
    "Draft a reply",
    "Draft a reply and show it to me",
    "Write a draft answer",
    "Suggest a reply",
    "Rascunho de resposta",
    "Escreva um rascunho de resposta",
    "Sugira uma resposta",
    "Redáctame un borrador",
    "Borrador de respuesta",
    // Reading and summarising
    "Summarise this",
    "Summarise this mail",
    "Mail from Ana: what does she want?",
    "Resume este correo",
    "Resuma este email",
    "Resumir este e-mail",
    "Quem respondeu?",
    "Ana respondeu?",
    "Qual deveria ser a resposta?",
    "Devo responder?",
    "¿Qué debería responder?",
    "¿Contestó Ana?",
    // Refusals and holds
    "Do not send anything",
    "Don't reply yet",
    "não envie nada",
    "Não responda ainda",
    "no envíes nada",
    "Reply, but don't send until I say",
    "Responde mas espera eu confirmar",
    // The answer is for the person, here in the chat
    "Tell me what it says",
    "Let me know what she wants",
    "Reply here with the summary",
    "Answer me in the chat",
    "Me diz o que ela quer",
    "Responde aqui o que ela quer",
    "Dime qué dice",
    // Statements
    "I will reply later",
    "She will answer on Monday",
    "I replied yesterday",
    "",
    "   ",
  ];
  test.each(yes)("asks: %s", (t) => expect(asksToSendMail(t)).toBe(true));
  test.each(no)("does not ask: %s", (t) => expect(asksToSendMail(t)).toBe(false));

  test("a request in one sentence next to a draft in another still asks, and a hold in one blocks only its own", () => {
    expect(asksToSendMail("Draft looks good. Send it to bob@example.invalid")).toBe(true);
    expect(asksToSendMail("Summarise this. Then reply saying thanks")).toBe(true);
    expect(asksToSendMail("Don't reply yet. Summarise it first")).toBe(false);
  });

  test("a negation inside the words to send does not block the request", () => {
    expect(asksToSendMail("Reply that the invoice is not ready")).toBe(true);
    expect(asksToSendMail("Responde que não posso na segunda")).toBe(true);
  });

  test("known misses (kept as cards): a request phrased as a wish, or a hint", () => {
    expect(asksToSendMail("I think you should reply to this")).toBe(false);
    expect(asksToSendMail("It would be nice if Ana got an answer")).toBe(false);
    expect(asksToSendMail("Ana needs an answer today")).toBe(false);
  });
});
