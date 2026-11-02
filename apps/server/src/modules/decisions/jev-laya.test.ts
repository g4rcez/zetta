import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Laya } from "@zetta/laya";
import type { ActiveActor } from "../identity/access";
import { createJevDecider } from "./jev";
import { DecisionError } from "./service";

// Opt-in (loads the ~1.7 GB Laya weights): ZETTA_LAYA_TEST=1. Laya's systemOne output is Jev-compatible, so a loopback
// /v1/systemone server backed by real Laya exercises the Jev adapter's wire contract end to end (auth header, body, strict parsing).
const suite = process.env.ZETTA_LAYA_TEST === "1" ? describe : describe.skip;
const actor = { userId: "u" } as ActiveActor;
const OPTIONS = ["billing", "tech", "other"] as const;

suite("Jev adapter against a real Laya model behind a System One endpoint", () => {
  let model: Awaited<ReturnType<typeof Laya.load>>;
  let server: ReturnType<typeof Bun.serve>;
  let endpoint = "";
  const seen: { auth: string | null; body: any }[] = [];
  beforeAll(async () => {
    model = await Laya.load();
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const body = (await req.json()) as { state: string; questions: unknown };
        seen.push({ auth: req.headers.get("authorization"), body });
        if (req.headers.get("authorization") !== "Bearer test-key")
          return new Response("no", { status: 401 });
        return Response.json(await model.systemOne(body.state as never, body.questions as never));
      },
    });
    endpoint = `http://127.0.0.1:${server.port}/v1/systemone`;
  });
  afterAll(async () => {
    server.stop(true);
    await model.close();
  });
  const decider = (key = "test-key") =>
    createJevDecider(async () => Buffer.from(key), { endpoint, model: "laya", deadlineMs: 60_000 });
  const desc = {
    billing: "invoices, payments, subscriptions",
    tech: "bugs, errors, outages",
    other: "anything else",
  };

  test("routes real messages with probabilities over exactly the offered options", async () => {
    const a = await decider().choose(
      actor,
      "Please cancel my subscription and refund this month's invoice",
      "Route the message",
      OPTIONS,
      { descriptions: desc },
    );
    expect(a.choice).toBe("billing");
    expect(a.provenance.model).toBe("jev");
    expect(Object.keys(a.probabilities).sort()).toEqual([...OPTIONS].sort());
    const b = await decider().choose(
      actor,
      "The app crashes with error 500 every time I open settings",
      "Route the message",
      OPTIONS,
      { descriptions: desc },
    );
    expect(b.choice).toBe("tech");
    expect(seen.at(-1)!.auth).toBe("Bearer test-key");
    expect(seen.at(-1)!.body.questions.pick.type).toBe("choice");
  }, 120_000);

  test("a low-confidence answer is uncertain; a rejected key and a model mismatch fail closed", async () => {
    const u = await decider().choose(actor, "hmm", "Route the message", OPTIONS, {
      descriptions: desc,
      minConfidence: 0.999,
    });
    expect(u.uncertain).toBe(true);
    expect(u.choice).toBeNull();
    await expect(decider("wrong").choose(actor, "x", "Route", OPTIONS)).rejects.toBeInstanceOf(
      DecisionError,
    );
    await expect(
      createJevDecider(async () => Buffer.from("test-key"), {
        endpoint,
        model: "jev-1.13.0",
      }).choose(actor, "x", "Route", OPTIONS),
    ).rejects.toMatchObject({ code: "invalid_output" });
  }, 120_000);
});
