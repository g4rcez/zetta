import { describe, expect, test } from "bun:test";
import { createDeviceHub, type DeviceSocket } from "./hub";

function socket() {
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const s: DeviceSocket & { closed: number; sent: typeof sent } = {
    closed: 0,
    sent,
    send: (d) => void sent.push(JSON.parse(d)),
    close() {
      this.closed++;
    },
  };
  return s;
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code,
  );

describe("device hub", () => {
  test("a request goes to the device and its answer comes back by id", async () => {
    const hub = createDeviceHub({ newId: () => "r1" });
    const s = socket();
    hub.attach("d1", s);
    expect(hub.online("d1")).toBe(true);
    const call = hub.call("d1", "run", { command: "uname" });
    expect(s.sent).toEqual([{ id: "r1", method: "run", params: { command: "uname" } }]);
    hub.receive("d1", JSON.stringify({ id: "r1", result: { output: "Darwin", exitCode: 0 } }));
    expect(await call).toEqual({ output: "Darwin", exitCode: 0 });
  });

  test("a device that is not connected is unreachable", async () => {
    expect(await code(createDeviceHub().call("nobody", "run", {}))).toBe("UNREACHABLE");
  });

  test("an answer counts only from the device that was asked, and only once", async () => {
    const hub = createDeviceHub({ newId: () => "r1", timeoutMs: 40 });
    hub.attach("d1", socket());
    hub.attach("d2", socket());
    const call = hub.call("d1", "run", {});
    hub.receive("d2", JSON.stringify({ id: "r1", result: { output: "forged", exitCode: 0 } }));
    expect(await code(call)).toBe("SLOW");
    const again = hub.call("d1", "run", {});
    hub.receive("d1", "not json");
    hub.receive("d1", JSON.stringify({ result: "no id" }));
    expect(await code(again)).toBe("SLOW");
  });

  test("a refusal and an unsupported request keep their meaning", async () => {
    let n = 0;
    const hub = createDeviceHub({ newId: () => `r${++n}` });
    hub.attach("d1", socket());
    const denied = hub.call("d1", "run", {});
    hub.receive("d1", JSON.stringify({ id: "r1", error: { code: "DENIED" } }));
    expect(await code(denied)).toBe("DENIED");
    const unsupported = hub.call("d1", "put", {});
    hub.receive("d1", JSON.stringify({ id: "r2", error: { code: "UNSUPPORTED" } }));
    expect(await code(unsupported)).toBe("UNSUPPORTED");
    const other = hub.call("d1", "run", {});
    hub.receive("d1", JSON.stringify({ id: "r3", error: { code: "weird" } }));
    expect(await code(other)).toBe("UNAVAILABLE");
  });

  test("a request that takes too long fails, and so does one the caller cancels", async () => {
    const hub = createDeviceHub({ timeoutMs: 30 });
    hub.attach("d1", socket());
    expect(await code(hub.call("d1", "run", {}))).toBe("SLOW");
    const controller = new AbortController();
    const cancelled = hub.call("d1", "run", {}, { signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    expect(await code(cancelled)).toBe("SLOW");
  });

  test("when the connection closes, what was waiting fails; a replaced connection closing late does not drop its successor", async () => {
    const hub = createDeviceHub({ timeoutMs: 5_000 });
    const first = socket();
    hub.attach("d1", first);
    const waiting = hub.call("d1", "run", {});
    const second = socket();
    hub.attach("d1", second);
    expect(first.closed).toBe(1);
    expect(await code(waiting)).toBe("UNREACHABLE");
    hub.detach("d1", first);
    expect(hub.online("d1")).toBe(true);
    const next = hub.call("d1", "run", {});
    hub.detach("d1", second);
    expect(hub.online("d1")).toBe(false);
    expect(await code(next)).toBe("UNREACHABLE");
  });

  test("dropping a device closes it and fails what was waiting as revoked", async () => {
    const hub = createDeviceHub({ timeoutMs: 5_000 });
    const s = socket();
    hub.attach("d1", s);
    const waiting = hub.call("d1", "run", {});
    hub.drop("d1");
    expect(s.closed).toBe(1);
    expect(hub.online("d1")).toBe(false);
    expect(await code(waiting)).toBe("REVOKED");
  });

  test("a socket that cannot send fails the request at once", async () => {
    const hub = createDeviceHub();
    hub.attach("d1", {
      send() {
        throw new Error("closed");
      },
      close() {},
    });
    expect(await code(hub.call("d1", "run", {}))).toBe("UNREACHABLE");
  });
});
