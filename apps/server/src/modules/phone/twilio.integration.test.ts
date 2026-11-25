// Phone calls through Twilio end to end against Postgres (run with ZETTA_TEST_DB=embedded; without it this suite skips, which looks like a
// pass: the run says how many tests were skipped). The fake Twilio signs real webhooks (`X-Twilio-Signature`) that go through the real
// routes and answers the REST calls; the media socket is a real WebSocket to the real route, driven the way Twilio's Media Streams speak
// (`connected`, `start` with custom parameters, `media`, `dtmf`, `stop`). The bot is a scripted engine; the recognizer and the voice are
// fakes. A fake Telnyx runs beside it so a number of each provider is handled by its own adapter. No real Twilio account and no real
// phone were used. Nothing here waits on a fixed time: every step reads state only once it has been written.
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, asc, eq, inArray } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { auditEvent } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { phoneNumber, phoneOptout, phoneWebhookEvent } from "@zetta/db/schema/phone";
import { voiceCall } from "@zetta/db/schema/voice";
import { Elysia } from "elysia";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createMembershipLookup, issueBackgroundActor } from "../identity/access";
import { activate, world } from "../integrations/plugins/test-world";
import type { ConfiguredSynthesizer } from "../speech/configured";
import { concat, silence, tone } from "../voice/core/test-audio";
import type { VoiceTranscriber } from "../voice/core/types";
import { createPhoneCallRoutes } from "./call-routes";
import { createPhoneCalls } from "./calls";
import { startFakeTelnyx } from "./fake";
import { connectStream, parseStreamTwiml, startFakeTwilio } from "./fake-twilio";
import "./live";
import "./outbound";
import { hashPin } from "./pin";
import { createReplayStore } from "./replay";
import { createPhoneService } from "./service";
import { createTelnyxProvider } from "./telnyx";
import { createTwilioProvider, rejectTwiml } from "./twilio";
import { encodeAudio, parseWire } from "./wire";
import { WORDS } from "./words";

setDefaultTimeout(30_000);
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const OWNER = `ph-tw-${uuidv7()}`;
const OWNER_NAME = "Ana Test";
const ids = [OWNER];
const OWNER_PHONE = "+12125550142";
const PIN = "4321";
let nextNumber = 10;
let nextCallee = 100;
const callee = () => `+1202555${String(nextCallee++).padStart(4, "0")}`;
const eventIds: string[] = [];
const newSid = () => `CA${uuidv7().replaceAll("-", "")}`;

const fence = (plugin: string, tool: string, args: object) =>
  `\`\`\`zetta:plugin\n${JSON.stringify({ plugin, tool, args })}\n\`\`\``;

suite("phone calls through Twilio against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = createMembershipLookup(db);
  const twilio = startFakeTwilio();
  const telnyx = startFakeTelnyx();
  const twilioProvider = createTwilioProvider({
    accountSid: twilio.accountSid,
    authToken: twilio.authToken,
    publicUrl: twilio.publicUrl,
    baseUrl: twilio.baseUrl,
  });
  const telnyxProvider = createTelnyxProvider({
    apiKey: telnyx.apiKey,
    publicKey: telnyx.publicKey,
    connectionRef: telnyx.connectionRef,
    baseUrl: telnyx.baseUrl,
  });
  const base = {
    phoneProvider: "telnyx" as const,
    phonePublicKey: telnyx.publicKey,
    phonePublicUrl: twilio.publicUrl,
    phoneApplicationId: telnyx.connectionRef,
    phoneRequestMode: "owner_request" as const,
    phoneCountries: "US",
    phoneMaxNumbers: 5,
    phoneMaxCallMinutes: 30,
    phoneDailyMinutesPerBot: 60,
    phoneDailyCallsPerBot: 20,
    phoneTwilio: "on" as const,
    phoneTwilioAccountSid: twilio.accountSid,
    phoneDefaultProvider: "twilio" as const,
  };
  let live = { ...base };
  const reader = {
    offer: async () => ({
      on: true,
      mode: "owner_request" as const,
      countries: ["US"],
      maxNumbers: 5,
    }),
    provider: async (id?: "telnyx" | "twilio") =>
      id === "telnyx" ? telnyxProvider : twilioProvider,
    settings: async () => live as never,
  };
  const phoneSvc = createPhoneService({ db, reader: reader as never });

  // ---- the scripted bot: a call turn is recognised by its prompt and acts on what the other party said
  const prompts: { prompt: string; noCode?: boolean }[] = [];
  const callTurns: { prompt: string; noCode?: boolean }[] = [];
  const engine = (t: { prompt: string; noCode?: boolean }): string => {
    prompts.push(t);
    if (/You are on a telephone call that you placed/.test(t.prompt)) {
      callTurns.push(t);
      if (/Steps you already took/.test(t.prompt)) return "Goodbye.";
      return `Thank you. Goodbye.\n${fence("phone_line", "end_call", {
        outcome: "done",
        summary: "The order arrives on Friday.",
      })}`;
    }
    if (/hello there/.test(t.prompt)) return "Hello. How can I help you today?";
    return "Okay.";
  };
  const fakeRun = Object.assign(
    async (t: { prompt: string; noCode?: boolean }) => ({ text: engine(t), stopped: false }),
    {
      stream: async function* (t: { prompt: string; noCode?: boolean }) {
        yield engine(t);
      },
    },
  );
  const { plugins } = world();
  const chat = createChatService(
    db,
    fakeRun as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      plugins,
      openScope: () => undefined,
      runConfig: async () => undefined,
      tokenOf: async () => undefined,
      isBound: async () => false,
    } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    { backgroundActor: (userId: string) => issueBackgroundActor(lookup, userId) as never },
  );

  // ---- the other end: a fake recognizer and voice
  const transcripts: string[] = [];
  const transcriber: VoiceTranscriber = { transcribe: async () => transcripts.shift() ?? "" };
  const spoken: string[] = [];
  const synthesizer: ConfiguredSynthesizer = {
    mode: async () => "remote",
    settings: async () => ({}) as never,
    async synthesize() {
      return tone(100);
    },
    async *stream(text, o) {
      spoken.push(text);
      for (let i = 0; i < 2; i++) {
        if (o?.signal?.aborted) return;
        await Bun.sleep(3);
        yield tone(60, 0.1);
      }
    },
  };
  const limitsNow: Record<string, number> = { amdMs: 5000 };
  const calls = createPhoneCalls({
    db,
    phone: phoneSvc,
    reader: reader as never,
    replay: createReplayStore(db),
    chat,
    lookup,
    transcriber,
    synthesizer,
    leadMs: Number.POSITIVE_INFINITY,
    sleep: (ms, signal) => (signal?.aborted ? Promise.resolve() : Bun.sleep(Math.min(ms, 3))),
    limits: limitsNow,
  });
  const server = new Elysia().use(createPhoneCallRoutes(calls)).listen(0);
  const port = () => server.server!.port;
  const streamAddress = () => `ws://127.0.0.1:${port()}/api/phone/stream`;

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: OWNER_NAME,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
  });
  afterAll(async () => {
    server.stop(true);
    await calls.endAll();
    await db.delete(phoneOptout).where(eq(phoneOptout.reason, "caller_request"));
    if (eventIds.length)
      await db.delete(phoneWebhookEvent).where(inArray(phoneWebhookEvent.eventId, eventIds));
    await db.delete(phoneNumber).where(eq(phoneNumber.ownerUserId, OWNER));
    await cleanupTestUsers(db, ids);
    twilio.stop();
    telnyx.stop();
  });

  // ---- helpers
  const waitFor = async <T>(
    what: string,
    f: () => Promise<T | undefined | false> | T | undefined | false,
    ms = 10_000,
  ) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await f();
      if (v) return v as T;
      if (Date.now() > end)
        throw new Error(`timed out waiting for ${what}; spoken ${JSON.stringify(spoken)}`);
      await Bun.sleep(15);
    }
  };
  const mk = async (
    o: {
      status?: "active" | "held";
      inbound?: "anyone" | "owner_only" | "off";
      owner?: boolean;
      provider?: "twilio" | "telnyx";
      outbound?: "on" | "off";
    } = {},
  ) => {
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: OWNER,
        kind: "specialist",
        visibility: "private",
        name: `Phone${uuidv7().slice(-4)}`,
        slug: `phone-${uuidv7().slice(-8)}`,
        onboarded: true,
        harness: "pi",
        codeAccess: true,
      })
      .returning();
    // Built in, but not on by default: the person activates the phone plugins for the bot.
    for (const id of ["phone", "phone_out", "phone_line"])
      await activate(plugins, OWNER, id, b!.id);
    const n = nextNumber++;
    const [num] = await db
      .insert(phoneNumber)
      .values({
        ownerUserId: OWNER,
        botId: b!.id,
        e164: `+1415555${String(n).padStart(4, "0")}`,
        provider: o.provider ?? "twilio",
        country: "US",
        status: o.status ?? "active",
        inbound: o.inbound ?? "anyone",
        outbound: o.outbound ?? "on",
        ownerNumber: o.owner === false ? null : OWNER_PHONE,
        pinHash: o.owner === false ? null : await hashPin(PIN),
        heldUntil: o.status === "held" ? new Date(Date.now() + 86_400_000) : null,
      })
      .returning();
    return { bot: b!, number: num! };
  };

  type Hook = { body: string; headers: Record<string, string>; path: string };
  /** The id the replay table keeps for a webhook, so the file cleans up after itself. */
  const replayIdOf = (w: Hook) => {
    const p = new URLSearchParams(w.body);
    const sid = p.get("CallSid");
    if (w.path.endsWith("/voice")) return `tw:${sid}:voice`;
    if (p.get("AnsweredBy")) return `tw:${sid}:amd:${p.get("AnsweredBy")}`;
    return `tw:${sid}:${p.get("CallStatus")}:${p.get("SequenceNumber") ?? ""}`;
  };
  const post = async (w: Hook) => {
    eventIds.push(replayIdOf(w));
    return fetch(`http://127.0.0.1:${port()}${w.path}`, {
      method: "POST",
      headers: w.headers,
      body: w.body,
    });
  };

  type Line = {
    sid: string;
    twiml: string;
    stream: Awaited<ReturnType<typeof connectStream>>;
    heard(): { media: number; clears: number };
    send(pcm: Int16Array): Promise<void>;
    speak(text: string, ms?: number): Promise<void>;
    dtmf(digits: string): void;
    hangup(): Promise<void>;
  };
  let sequence = 1;
  /** Twilio's side of a call that rings on one of our numbers: the webhook is answered with TwiML, and Twilio opens the stream. */
  async function ring(from: string, to: string, o: { open?: boolean } = {}): Promise<Line> {
    const sid = newSid();
    const res = await post(twilio.voice(sid, from, to));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const twiml = await res.text();
    const target = parseStreamTwiml(twiml);
    expect(target.url).toBe("wss://zetta.example.invalid/api/phone/stream");
    expect(Object.keys(target.params)).toContain("token");
    const stream = await connectStream(streamAddress(), {
      accountSid: twilio.accountSid,
      callSid: sid,
    });
    if (o.open !== false) stream.open(target.params);
    return line(sid, twiml, stream);
  }
  function line(sid: string, twiml: string, stream: Line["stream"]): Line {
    const l: Line = {
      sid,
      twiml,
      stream,
      heard: () => ({
        media: stream.received.filter((m) => m.event === "media").length,
        clears: stream.received.filter((m) => m.event === "clear").length,
      }),
      async send(pcm) {
        for (let at = 0; at + 320 <= pcm.length; at += 320) {
          if (stream.ws.readyState !== WebSocket.OPEN) return;
          stream.media(encodeAudio(pcm.slice(at, at + 320), "PCMU"));
          await Bun.sleep(1);
        }
      },
      async speak(text, ms = 1000) {
        transcripts.push(text);
        await l.send(concat(silence(600), tone(ms), silence(400)));
      },
      dtmf(digits) {
        for (const d of digits) stream.dtmf(d);
      },
      async hangup() {
        await post(twilio.status(sid, "completed", sequence++));
      },
    };
    return l;
  }
  /** The REST calls that told Twilio to end this call. */
  const hangups = (sid: string) =>
    twilio.updates.filter((u) => u.sid === sid && u.form.Status?.[0] === "completed");
  const rowOf = (numberId: string) =>
    db
      .select()
      .from(voiceCall)
      .where(eq(voiceCall.numberId, numberId))
      .orderBy(asc(voiceCall.startedAt));
  const msgs = (convId: string) =>
    db.select().from(message).where(eq(message.conversationId, convId)).orderBy(asc(message.seq));
  const ready = async (numberId: string): Promise<string> =>
    (await waitFor(
      "the conversation",
      async () => (await rowOf(numberId)).find((r) => r.conversationId)?.conversationId,
    )) as string;
  const answered = async (convId: string, n = 1) =>
    waitFor("the bot's answer", async () => {
      const a = (await msgs(convId)).filter(
        (m) => m.role === "assistant" && m.status === "complete",
      );
      return a.length >= n ? a : undefined;
    });
  const ended = (numberId: string) =>
    waitFor("the call to end", async () => {
      const r = await rowOf(numberId);
      return r[0]?.status === "ended" ? r : undefined;
    });
  const room = (l: Line) => l.send(silence(600));

  describe("incoming", () => {
    test("an outside caller: TwiML answers with a stream and a token parameter, the greeting is first, the turn is spoken, the status callback ends the call", async () => {
      const { number, bot: b } = await mk();
      spoken.length = 0;
      const l = await ring("+15550100777", number.e164!);
      // The answer is the HTTP response: nothing was sent to the REST API, and the stream address has no query.
      expect(twilio.updates.filter((u) => u.sid === l.sid)).toHaveLength(0);
      expect(l.twiml).toContain("<Connect><Stream url=");
      expect(l.twiml).not.toContain("?token=");
      const convId = await ready(number.id);
      expect(spoken[0]).toBe(`Hello, this is ${OWNER_NAME}'s automated assistant.`);
      // What Zetta sends back carries the stream sid, in Twilio's mu-law audio.
      await waitFor("the greeting audio", () => l.heard().media > 1);
      const media = l.stream.received.find((m) => m.event === "media")!;
      expect(media.streamSid).toBe(l.stream.sid);
      expect(parseWire(JSON.stringify(media))).toMatchObject({ event: "media" });
      await room(l);
      await l.speak("hello there");
      const [reply] = await answered(convId);
      expect(reply!.content).toContain("How can I help you today?");
      await waitFor("the spoken reply", () =>
        spoken.some((s) => s.includes("How can I help you today?")),
      );
      const [conv] = await db.select().from(conversation).where(eq(conversation.id, convId));
      expect(conv).toMatchObject({ kind: "inbound", botId: b.id, ownerUserId: OWNER });
      expect(prompts.at(-1)!.noCode).toBe(true);
      // The row is active as soon as the stream opened (Twilio sends no "answered" for a call that rings on a number).
      expect((await rowOf(number.id))[0]).toMatchObject({ status: "active" });
      await l.hangup();
      const [row] = await ended(number.id);
      expect(row).toMatchObject({
        channel: "phone",
        direction: "in",
        peer: "+15550100777",
        trust: "outside",
        numberId: number.id,
        conversationId: convId,
        endReason: "hangup",
      });
      const trail = await waitFor("both audit rows", async () => {
        const r = await db
          .select()
          .from(auditEvent)
          .where(and(eq(auditEvent.subjectId, row!.id), eq(auditEvent.kind, "voice_call")));
        return r.length >= 2 ? r : undefined;
      });
      expect(trail.map((t) => t.detail).sort()).toEqual(["ended:hangup", "started"]);
    });

    test("the owner enters the PIN on the keypad: the key presses come on the stream, and the call becomes an owner chat", async () => {
      const { number, bot: b } = await mk();
      spoken.length = 0;
      const l = await ring(OWNER_PHONE, number.e164!);
      await waitFor("the PIN prompt", () => spoken.includes(WORDS.en.askPin));
      expect((await rowOf(number.id))[0]!.conversationId).toBeNull();
      l.dtmf(`${PIN}#`);
      await waitFor("thanks", () => spoken.includes(WORDS.en.pinOk));
      const convId = await ready(number.id);
      const [conv] = await db.select().from(conversation).where(eq(conversation.id, convId));
      expect(conv).toMatchObject({ kind: "chat", botId: b.id });
      expect((await rowOf(number.id))[0]).toMatchObject({ trust: "owner" });
      await room(l);
      await l.speak("hello there");
      await answered(convId);
      expect(prompts.at(-1)!.noCode).toBeFalsy();
      await l.hangup();
    });

    test("a wrong PIN on the stream is counted; three lock it", async () => {
      const { number } = await mk();
      spoken.length = 0;
      const l = await ring(OWNER_PHONE, number.e164!);
      await waitFor("the PIN prompt", () => spoken.includes(WORDS.en.askPin));
      for (let i = 0; i < 2; i++) {
        l.dtmf("0000#");
        await waitFor(
          `wrong PIN ${i + 1}`,
          () => spoken.filter((x) => x === WORDS.en.pinWrong).length > i,
        );
      }
      // The third wrong try locks the PIN: the call goes on as for any caller.
      l.dtmf("0000#");
      await waitFor("the PIN to be given up", () => spoken.includes(WORDS.en.pinSkipped));
      const [n] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, number.id));
      expect(n!.pinLockedUntil).not.toBeNull();
      await l.hangup();
    });

    test("owner_only: an outside caller is turned away with a fixed sentence and the call is ended through the REST API", async () => {
      const { number } = await mk({ inbound: "owner_only" });
      spoken.length = 0;
      const l = await ring("+15550100780", number.e164!);
      await waitFor("the hangup", () => hangups(l.sid).length > 0);
      expect(spoken).toContain(WORDS.en.greeting(OWNER_NAME));
      expect((await rowOf(number.id))[0]).toMatchObject({ conversationId: null });
    });

    test("a held number says it is not in service and hangs up", async () => {
      const { number } = await mk({ status: "held" });
      spoken.length = 0;
      const l = await ring("+15550100782", number.e164!);
      await waitFor("the hangup", () => hangups(l.sid).length > 0);
      expect(spoken).toEqual([WORDS.en.greeting(OWNER_NAME), WORDS.en.notInService]);
      expect((await rowOf(number.id))[0]).toMatchObject({
        status: "blocked",
        endReason: "refused",
        conversationId: null,
      });
    });

    test("a number we do not hold is rejected with TwiML, and nothing is created", async () => {
      const sid = newSid();
      const res = await post(twilio.voice(sid, "+15550100783", "+14155559999"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(rejectTwiml());
      expect(twilio.updates.filter((u) => u.sid === sid)).toHaveLength(0);
    });

    test("a second caller hears that the bot is busy; the first call is not disturbed", async () => {
      const { number } = await mk();
      const first = await ring("+15550100785", number.e164!);
      const convId = await ready(number.id);
      spoken.length = 0;
      const second = await ring("+15550100786", number.e164!);
      await waitFor("the busy hangup", () => hangups(second.sid).length > 0);
      expect(spoken).toContain(WORDS.en.busy);
      expect(hangups(first.sid)).toHaveLength(0);
      await room(first);
      await first.speak("hello there");
      await answered(convId);
      await first.hangup();
    });

    test("the bot's daily calls are limited: outsiders hear the limit sentence", async () => {
      const { number } = await mk();
      live = { ...base, phoneDailyCallsPerBot: 1 };
      try {
        const l1 = await ring("+15550100789", number.e164!);
        await ready(number.id);
        await l1.hangup();
        await ended(number.id);
        spoken.length = 0;
        const l2 = await ring("+15550100790", number.e164!);
        await waitFor("the limit hangup", () => hangups(l2.sid).length > 0);
        expect(spoken).toEqual([WORDS.en.greeting(OWNER_NAME), WORDS.en.limit]);
      } finally {
        live = { ...base };
      }
    });

    test("an outside call ends at its time limit with a sentence, and the REST API is told to end it", async () => {
      const a = await mk();
      limitsNow.outsideMaxMs = 1200;
      try {
        spoken.length = 0;
        const l = await ring("+15550100787", a.number.e164!);
        await waitFor("the time limit", () => spoken.includes(WORDS.en.timeUp), 6000);
        await waitFor("the hangup", () => hangups(l.sid).length > 0);
        const [row] = await ended(a.number.id);
        expect(row!.endReason).toBe("time_limit");
      } finally {
        delete limitsNow.outsideMaxMs;
      }
    });

    test("a caller who asks not to be called again goes on the do-not-call list", async () => {
      const { number } = await mk();
      const l = await ring("+15550100791", number.e164!);
      const convId = await ready(number.id);
      await room(l);
      await l.speak("please don't call me again");
      await waitFor(
        "the list",
        async () =>
          (await db.select().from(phoneOptout).where(eq(phoneOptout.e164, "+15550100791")))[0],
      );
      expect(await phoneSvc.isOptedOut("+15550100791")).toBe(true);
      expect(
        (await msgs(convId)).some((m) => m.role === "system" && m.content.startsWith("📵")),
      ).toBe(true);
      await l.hangup();
    });

    test("when the stream stops, the call ends", async () => {
      const { number } = await mk();
      const l = await ring("+15550100793", number.e164!);
      await ready(number.id);
      l.stream.stop();
      const [row] = await ended(number.id);
      expect(row!.endReason).toBe("disconnected");
    });
  });

  describe("the webhook and socket doors", () => {
    test("a bad signature, a wrong token, a wrong address, another host and a missing signature are refused, and nothing is created", async () => {
      const { number } = await mk();
      const good = twilio.voice(newSid(), "+15550100801", number.e164!);
      const tampered = { ...good, body: good.body.replace("5550100801", "5550100899") };
      expect((await post(tampered)).status).toBe(401);
      const wrongToken = twilio.webhook(
        good.path,
        Object.fromEntries(new URLSearchParams(good.body)),
        { token: "other-token" },
      );
      expect((await post(wrongToken)).status).toBe(401);
      const wrongUrl = twilio.webhook(
        good.path,
        Object.fromEntries(new URLSearchParams(good.body)),
        { url: "https://evil.example.invalid/api/phone/twilio/voice" },
      );
      expect((await post(wrongUrl)).status).toBe(401);
      expect(
        (await post({ ...good, headers: { ...good.headers, host: "evil.example.invalid" } }))
          .status,
      ).toBe(401);
      const { "x-twilio-signature": _gone, ...unsigned } = good.headers;
      expect((await post({ ...good, headers: unsigned })).status).toBe(401);
      expect(await rowOf(number.id)).toHaveLength(0);
    });

    test("a replay of a status callback is refused, also by a second instance sharing the database; a changed sequence is a new event", async () => {
      const sid = newSid();
      const completed = twilio.status(sid, "completed", 7);
      expect((await post(completed)).status).toBe(200);
      expect((await post(completed)).status).toBe(409);
      const other = createPhoneCalls({
        db,
        phone: phoneSvc,
        reader: reader as never,
        replay: createReplayStore(db),
        chat,
        lookup,
        transcriber,
        synthesizer,
      });
      expect(
        (
          await other.webhook(completed.body, new Headers(completed.headers), {
            provider: "twilio",
            path: completed.path,
          })
        ).status,
      ).toBe(409);
      const fresh = twilio.status(sid, "completed", 8);
      expect((await post(fresh)).status).toBe(200);
    });

    test("the voice webhook of a call is not handled twice", async () => {
      const { number } = await mk();
      const w = twilio.voice(newSid(), "+15550100802", number.e164!);
      expect((await post(w)).status).toBe(200);
      expect((await post(w)).status).toBe(409);
      expect((await rowOf(number.id)).length).toBeLessThanOrEqual(1);
    });

    test("a socket must name its call in the start message, once: a wrong token, none, a repeat and a silent socket are closed", async () => {
      const { number } = await mk();
      const l = await ring("+15550100792", number.e164!);
      await ready(number.id);
      const target = parseStreamTwiml(l.twiml);
      const again = await connectStream(streamAddress(), {
        accountSid: twilio.accountSid,
        callSid: l.sid,
      });
      again.open(target.params);
      await waitFor("the repeat to be closed", () => again.closed.code);
      expect(again.closed.code).toBe(4401);
      const wrong = await connectStream(streamAddress(), {
        accountSid: twilio.accountSid,
        callSid: l.sid,
      });
      wrong.open({ token: "nope" });
      await waitFor("a wrong token to be closed", () => wrong.closed.code);
      expect(wrong.closed.code).toBe(4401);
      const none = await connectStream(streamAddress(), {
        accountSid: twilio.accountSid,
        callSid: l.sid,
      });
      none.open({});
      await waitFor("no token to be closed", () => none.closed.code);
      expect(none.closed.code).toBe(4401);
      // A token in the address (Telnyx's way) is no use for a Twilio call.
      const viaQuery = new WebSocket(
        `${streamAddress()}?token=${encodeURIComponent(target.params.token!)}`,
      );
      expect(
        await new Promise<number>((r) => viaQuery.addEventListener("close", (e) => r(e.code))),
      ).toBe(4401);
      await l.hangup();
    });

    test("a socket that never sends its start message is closed", async () => {
      limitsNow.connectMs = 300;
      try {
        const ws = new WebSocket(streamAddress());
        const code = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
        await new Promise<void>((r) => ws.addEventListener("open", () => r()));
        ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
        expect(await code).toBe(4401);
      } finally {
        delete limitsNow.connectMs;
      }
    });
  });

  describe("outgoing", () => {
    const dial = async (o: { voicemail?: "hang_up" | "leave_message" } = {}) => {
      const { bot: b, number } = await mk({ inbound: "off" });
      const to = callee();
      const before = twilio.placed.length;
      const res = await calls.place({
        userId: OWNER,
        botId: b.id,
        to,
        briefing: "Ask whether the order arrived.",
        maxMinutes: 5,
        voicemail: o.voicemail ?? "hang_up",
        requestedIn: null,
      });
      expect(res.ok).toBe(true);
      const placed = await waitFor("the dial", () => twilio.placed[before]);
      return { bot: b, number, to, placed };
    };
    /** Twilio's side of a call that was dialled: the callee picks up, the TwiML opens the stream, detection says who. */
    async function pickUp(
      placed: { sid: string; form: Record<string, string[]> },
      who: "human" | "machine_start" | "none" = "human",
    ) {
      const target = parseStreamTwiml(placed.form.Twiml![0]!);
      const stream = await connectStream(streamAddress(), {
        accountSid: twilio.accountSid,
        callSid: placed.sid,
      });
      stream.open(target.params);
      await post(twilio.status(placed.sid, "in-progress", sequence++));
      if (who !== "none") await post(twilio.machine(placed.sid, who));
      return line(placed.sid, placed.form.Twiml![0]!, stream);
    }
    const over = (botId: string) =>
      waitFor("the call to end", async () =>
        (await db.select().from(voiceCall).where(eq(voiceCall.botId, botId))).find(
          (x) => x.outcome,
        ),
      );

    test("a bot's call is created with the TwiML stream, the status events and machine detection; the callee talks; end_call(done) ends it through the REST API", async () => {
      spoken.length = 0;
      const { bot: b, number, to, placed } = await dial();
      expect(placed.form).toMatchObject({
        To: [to],
        From: [number.e164],
        StatusCallbackEvent: ["answered", "completed"],
        MachineDetection: ["Enable"],
        AsyncAmd: ["true"],
        TimeLimit: [String(5 * 60 + 30)],
      });
      const target = parseStreamTwiml(placed.form.Twiml![0]!);
      expect(target.url).toBe("wss://zetta.example.invalid/api/phone/stream");
      expect(target.params.token).toBeTruthy();
      const [row0] = await db.select().from(voiceCall).where(eq(voiceCall.botId, b.id));
      expect(row0).toMatchObject({
        direction: "out",
        channel: "phone",
        peer: to,
        numberId: number.id,
        status: "ringing",
      });
      const l = await pickUp(placed);
      await waitFor("the opening", () => spoken.length > 0);
      expect(spoken[0]).toBe(
        `Hello, I'm an automated assistant calling on behalf of ${OWNER_NAME}.`,
      );
      await l.speak("Hello? Yes, who is this?");
      const done = await over(b.id);
      expect(done).toMatchObject({ outcome: "done", status: "ended", endReason: "hangup" });
      expect(callTurns.at(-1)!.noCode).toBe(true);
      expect(callTurns.at(-1)!.prompt).toContain("Ask whether the order arrived.");
      await waitFor("the hangup", () => hangups(placed.sid).length > 0);
    });

    test("an answering machine: with hang_up the call ends without a word", async () => {
      spoken.length = 0;
      const { bot: b, placed } = await dial();
      await pickUp(placed, "machine_start");
      const done = await over(b.id);
      expect(done.outcome).toBe("voicemail");
      expect(spoken.some((s) => s.startsWith("Hello, I'm an automated"))).toBe(false);
      await waitFor("the hangup", () => hangups(placed.sid).length > 0);
    });

    test("the callee asks not to be called again: the number goes on the list and the call ends politely", async () => {
      spoken.length = 0;
      const { bot: b, to, placed } = await dial();
      const l = await pickUp(placed);
      await waitFor("the opening", () => spoken.length > 0);
      await l.speak("Please don't call me again");
      const done = await over(b.id);
      expect(done.outcome).toBe("declined");
      expect(spoken).toContain(WORDS.en.optoutBye);
      expect(await db.select().from(phoneOptout).where(eq(phoneOptout.e164, to))).toMatchObject([
        { reason: "caller_request" },
      ]);
    });

    test("a call that is not answered ends when the provider says so", async () => {
      const { bot: b, placed } = await dial();
      await post(twilio.status(placed.sid, "no-answer", sequence++));
      const r = await waitFor("the row to end", async () => {
        const [x] = await db.select().from(voiceCall).where(eq(voiceCall.botId, b.id));
        return x?.status === "ended" ? x : undefined;
      });
      expect(r.endReason).toBe("hangup");
    });

    test("a bot with a Twilio number dials through Twilio, never through Telnyx", async () => {
      const telnyxBefore = telnyx.placed.length;
      const { placed } = await dial();
      expect(placed.sid).toMatch(/^CA/);
      expect(telnyx.placed.length).toBe(telnyxBefore);
    });
  });

  describe("two providers", () => {
    test("a number of each provider is handled by its own adapter, through its own door", async () => {
      const tw = await mk({ provider: "twilio" });
      const tn = await mk({ provider: "telnyx", inbound: "anyone" });
      spoken.length = 0;
      // The Twilio number: TwiML, no REST answer. The Telnyx number: an answer action at Telnyx, no TwiML.
      const l = await ring("+15550100810", tw.number.e164!);
      expect(telnyx.calls.some((c) => c.path.includes("/actions/"))).toBe(false);
      const id = `v3:call-${uuidv7()}`;
      const w = telnyx.webhook("call.initiated", {
        call_control_id: id,
        call_session_id: `s-${id}`,
        from: "+15550100811",
        to: tn.number.e164,
        direction: "incoming",
      });
      eventIds.push((JSON.parse(w.body) as { data: { id: string } }).data.id);
      const res = await fetch(`http://127.0.0.1:${port()}/api/phone/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", ...w.headers },
        body: w.body,
      });
      expect(res.status).toBe(200);
      const answer = await waitFor("Telnyx's answer action", () =>
        telnyx.calls.find(
          (c) => c.path.endsWith("/actions/answer") && c.path.includes(encodeURIComponent(id)),
        ),
      );
      expect(
        (answer.body as { stream_bidirectional_codec: string }).stream_bidirectional_codec,
      ).toBe("PCMU");
      expect(twilio.updates.filter((u) => u.sid === id)).toHaveLength(0);
      await l.hangup();
    });

    test("a call for a Twilio number that reaches Telnyx's door, or a Telnyx number at Twilio's, is turned away", async () => {
      const tw = await mk({ provider: "twilio" });
      const tn = await mk({ provider: "telnyx" });
      // Twilio's door, Telnyx's number: a rejection in TwiML.
      const res = await post(twilio.voice(newSid(), "+15550100812", tn.number.e164!));
      expect(await res.text()).toBe(rejectTwiml());
      // Telnyx's door, Twilio's number: a reject action at Telnyx.
      const id = `v3:call-${uuidv7()}`;
      const w = telnyx.webhook("call.initiated", {
        call_control_id: id,
        call_session_id: `s-${id}`,
        from: "+15550100813",
        to: tw.number.e164,
        direction: "incoming",
      });
      eventIds.push((JSON.parse(w.body) as { data: { id: string } }).data.id);
      await fetch(`http://127.0.0.1:${port()}/api/phone/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", ...w.headers },
        body: w.body,
      });
      await waitFor("Telnyx's reject action", () =>
        telnyx.calls.find(
          (c) => c.path.endsWith("/actions/reject") && c.path.includes(encodeURIComponent(id)),
        ),
      );
      expect(await rowOf(tw.number.id)).toHaveLength(0);
      expect(await rowOf(tn.number.id)).toHaveLength(0);
    });

    test("keys pressed on a Telnyx stream are ignored (its keys come as webhooks); on a Twilio stream they count", async () => {
      const tn = await mk({ provider: "telnyx" });
      spoken.length = 0;
      const id = `v3:call-${uuidv7()}`;
      const post1 = async (type: string, extra: Record<string, unknown> = {}) => {
        const w = telnyx.webhook(type, {
          call_control_id: id,
          call_session_id: `s-${id}`,
          ...extra,
        });
        eventIds.push((JSON.parse(w.body) as { data: { id: string } }).data.id);
        return fetch(`http://127.0.0.1:${port()}/api/phone/webhook`, {
          method: "POST",
          headers: { "content-type": "application/json", ...w.headers },
          body: w.body,
        });
      };
      await post1("call.initiated", {
        from: OWNER_PHONE,
        to: tn.number.e164,
        direction: "incoming",
      });
      const answer = await waitFor("the answer", () =>
        telnyx.calls.find(
          (c) => c.path.endsWith("/actions/answer") && c.path.includes(encodeURIComponent(id)),
        ),
      );
      const address = new URL((answer.body as { stream_url: string }).stream_url);
      const ws = new WebSocket(`ws://127.0.0.1:${port()}/api/phone/stream${address.search}`);
      await new Promise<void>((r) => ws.addEventListener("open", () => r()));
      ws.send(
        JSON.stringify({
          event: "start",
          start: { media_format: { encoding: "PCMU" } },
          stream_id: "st",
        }),
      );
      await post1("call.answered");
      await waitFor("the PIN prompt", () => spoken.includes(WORDS.en.askPin));
      // A wrong PIN on the stream would be counted if Telnyx's stream carried keys; it does not, so it is ignored.
      for (const d of "0000#") ws.send(JSON.stringify({ event: "dtmf", dtmf: { digit: d } }));
      for (const d of `${PIN}#`) await post1("call.dtmf.received", { digit: d });
      await waitFor("thanks", () => spoken.includes(WORDS.en.pinOk));
      expect(spoken).not.toContain(WORDS.en.pinWrong);
      expect(
        (await db.select().from(phoneNumber).where(eq(phoneNumber.id, tn.number.id)))[0]!
          .pinFailures,
      ).toBe(0);
      await post1("call.hangup");
    });
  });
});
