import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPublicUrl, ComputerError, createComputerService } from "./service";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e as ComputerError).code,
  );

describe("assertPublicUrl", () => {
  test("blocks local, private and non-http targets", async () => {
    for (const u of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://169.254.169.254/latest",
      "http://[::1]/",
      "file:///etc/passwd",
      "ftp://example.com",
      "http://x.local",
      "not a url",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://100.64.0.1/",
      "http://198.18.0.1/",
      "http://224.0.0.1/",
      "http://[64:ff9b::7f00:1]/",
      "http://[fd00::1]/",
      "http://0.0.0.0/",
      "http://2130706433/",
    ])
      expect(await code(assertPublicUrl(u))).toBe("BLOCKED_URL");
    expect(await code(assertPublicUrl("http://93.184.216.34/"))).toBe("ok");
  });
});

// Real Chrome through agent-browser (installed and able to find a browser), so it is opt-in.
const real = process.env.ZETTA_COMPUTER_TEST === "1" ? describe : describe.skip;
real("computer sessions (real chromium)", async () => {
  const root = await mkdtemp(join(tmpdir(), "zetta-computer-"));
  const form = `<html><body><label>Name <input id=n></label><button onclick="document.body.append('sent ' + document.getElementById('n').value)">Send</button></body></html>`;
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/form"
        ? new Response(form, { headers: { "content-type": "text/html" } })
        : new URL(req.url).pathname === "/login"
          ? new Response("<html><body><form><input type=password></form></body></html>", {
              headers: { "content-type": "text/html" },
            })
          : new Response(
              "<html><body><button id=b onclick=\"document.title='clicked'\" style='position:fixed;left:10px;top:10px;width:100px;height:40px'>Go</button><p>Hello computer use</p></body></html>",
              { headers: { "content-type": "text/html" } },
            ),
  });
  const svc = createComputerService({ root, allowPrivate: true });
  afterAll(async () => {
    await svc.closeAll();
    server.stop(true);
  });
  const url = `http://localhost:${server.port}/`;

  test("opens, reads, clicks, screenshots, and respects human takeover", async () => {
    await svc.start("u1", "p1");
    const text = await svc.read("u1", "p1", url);
    expect(text).toContain("Hello computer use");
    await svc.act("u1", "p1", "agent", { type: "click", x: 30, y: 25 });
    expect((await svc.screenshot("u1", "p1")).length).toBeGreaterThan(1000);
    svc.takeover("u1", "p1", true);
    expect(await code(svc.act("u1", "p1", "agent", { type: "scroll", dy: 10 }))).toBe(
      "HUMAN_IN_CONTROL",
    );
    expect(await code(svc.act("u1", "p1", "user", { type: "scroll", dy: 10 }))).toBe("ok");
    svc.takeover("u1", "p1", false);
    expect(await code(svc.act("u1", "p1", "agent", { type: "scroll", dy: 10 }))).toBe("ok");
  }, 60_000);

  test("a snapshot gives refs a bot can click and fill; a stale ref is NO_ELEMENT", async () => {
    const formUrl = `http://localhost:${server.port}/form`;
    await svc.start("u4", "refs");
    await svc.act("u4", "refs", "agent", { type: "open", url: formUrl });
    const snap = await svc.snapshot("u4", "refs");
    expect(snap).toContain("url: " + formUrl);
    const name = /textbox "Name" \[ref=(e\d+)\]/.exec(snap)?.[1]; // refs are read from the snapshot, as a bot does
    const send = /button "Send" \[ref=(e\d+)\]/.exec(snap)?.[1];
    expect(name).toBeDefined();
    expect(send).toBeDefined();
    await svc.act("u4", "refs", "agent", { type: "fill", ref: `@${name}`, text: "Ada" });
    await svc.act("u4", "refs", "agent", { type: "click_ref", ref: send! });
    expect(await svc.text("u4", "refs")).toContain("sent Ada");
    expect(await code(svc.act("u4", "refs", "agent", { type: "click_ref", ref: "@e99" }))).toBe(
      "NO_ELEMENT",
    );
    expect(await code(svc.act("u4", "refs", "agent", { type: "click_ref", ref: "button" }))).toBe(
      "INVALID",
    );
    await svc.close("u4", "refs");
  }, 60_000);

  test("actions on one profile are serialized, epoch-guarded against takeover, cancellable, and login pages are detected", async () => {
    const loginUrl = `http://localhost:${server.port}/login`;
    await svc.start("u3", "serial");
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        svc
          .act("u3", "serial", "agent", { type: "open", url: url + "?n=" + n })
          .then(() => order.push(n)),
      ),
    );
    expect(order).toEqual([1, 2, 3]); // no interleaving between concurrent callers
    const epoch = svc.epochOf("u3", "serial");
    svc.takeover("u3", "serial", true);
    svc.takeover("u3", "serial", false); // a person took over and handed back in between
    expect(await code(svc.act("u3", "serial", "agent", { type: "scroll", dy: 5 }, { epoch }))).toBe(
      "STALE_CONTROL",
    );
    expect(
      await code(
        svc.act(
          "u3",
          "serial",
          "agent",
          { type: "scroll", dy: 5 },
          { epoch: svc.epochOf("u3", "serial") },
        ),
      ),
    ).toBe("ok");
    expect(() => svc.takeover("u3", "serial", true, "human")).toThrow(); // compare-and-swap on the observed state
    const ac = new AbortController();
    ac.abort();
    expect(
      await code(
        svc.act("u3", "serial", "agent", { type: "scroll", dy: 5 }, { signal: ac.signal }),
      ),
    ).toBe("CANCELLED");
    const res = await svc.act("u3", "serial", "agent", { type: "open", url: loginUrl });
    expect((res as { loginRequired: boolean }).loginRequired).toBe(true);
    await svc.close("u3", "serial");
  }, 60_000);

  test("sessions are per user and limited", async () => {
    expect(await code(svc.screenshot("u2", "p1"))).toBe("NOT_FOUND"); // u2 cannot address u1's session
    await svc.start("u1", "p2");
    expect(await code(svc.start("u1", "p3"))).toBe("LIMIT");
    expect(await code(svc.start("u1", "../x"))).toBe("INVALID");
  }, 60_000);
});
