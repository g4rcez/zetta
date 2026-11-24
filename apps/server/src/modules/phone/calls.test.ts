// The provider's webhook door, without a database: the signature, the age and the replay of an event, with two service instances that
// share one record of seen ids (the way two processes share the database).
import { afterAll, describe, expect, test } from "bun:test";
import { startFakeTelnyx } from "./fake";
import { createPhoneCalls } from "./calls";
import type { ReplayStore } from "./replay";
import { createTelnyxProvider } from "./telnyx";

const fake = startFakeTelnyx();
afterAll(() => fake.stop());

const sharedSeen = new Set<string>();
const replay: ReplayStore = {
  claim: async (id) => {
    if (sharedSeen.has(id)) return false;
    sharedSeen.add(id);
    return true;
  },
  release: async (id) => void sharedSeen.delete(id),
};
const instance = (key = fake.publicKey) => {
  const provider = createTelnyxProvider({
    apiKey: fake.apiKey,
    publicKey: key,
    connectionRef: fake.connectionRef,
    baseUrl: fake.baseUrl,
  });
  return createPhoneCalls({
    db: {} as never,
    phone: { checkPin: async () => "none", optOutCaller: async () => undefined },
    reader: { provider: async () => provider, settings: async () => ({}) as never },
    replay,
    chat: {} as never,
    lookup: async () => null,
    transcriber: { transcribe: async () => "" },
    synthesizer: {} as never,
  });
};
const send = (
  calls: ReturnType<typeof instance>,
  w: { body: string; headers: Record<string, string> },
) => calls.webhook(w.body, new Headers(w.headers));
// An event the handler ignores: a hangup of a call this process does not hold.
const hangup = (o?: { id?: string; at?: number }) =>
  fake.webhook("call.hangup", { call_control_id: "v3:none" }, o);

describe("webhook verification", () => {
  test("a good signature is accepted", async () => {
    expect((await send(instance(), hangup())).status).toBe(200);
  });
  test("a bad signature, a body changed after signing, and a missing signature are refused", async () => {
    const w = hangup();
    expect(
      (await send(instance(), { ...w, body: w.body.replace("v3:none", "v3:other") })).status,
    ).toBe(401);
    expect((await send(instance(), { body: w.body, headers: {} })).status).toBe(401);
    const other = startFakeTelnyx();
    try {
      expect((await send(instance(), other.webhook("call.hangup"))).status).toBe(401);
    } finally {
      other.stop();
    }
  });
  test("with no public key set, everything is refused", async () => {
    expect((await send(instance(""), hangup())).status).toBe(401);
  });
  test("an old event and one from the future are refused", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await send(instance(), hangup({ at: now - 3600 }))).status).toBe(401);
    expect((await send(instance(), hangup({ at: now + 3600 }))).status).toBe(401);
  });
  test("the same event twice is refused, also by a second instance that never saw it", async () => {
    const w = hangup({ id: "evt-replay-1" });
    const a = instance();
    const b = instance();
    expect((await send(a, w)).status).toBe(200);
    expect((await send(a, w)).status).toBe(409);
    expect((await send(b, w)).status).toBe(409);
  });
});
