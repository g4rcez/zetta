import { describe, expect, test } from "bun:test";
import { openVncBridge, vncPassword, vncResponse } from "./vnc";

/** A minimal RFB 3.8 server offering VNC authentication: the challenge, then ServerInit-like bytes after ClientInit. */
function fakeVncServer(password: string) {
  const challenge = Buffer.from("0123456789abcdef");
  const got: Buffer[] = [];
  const server = Bun.listen<{ stage: number; buf: Buffer }>({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(s) { s.data = { stage: 0, buf: Buffer.alloc(0) }; s.write("RFB 003.008\n"); },
      data(s, chunk) {
        const d = s.data; d.buf = Buffer.concat([d.buf, chunk]);
        if (d.stage === 0 && d.buf.length >= 12) { d.buf = d.buf.subarray(12); d.stage = 1; s.write(Uint8Array.of(2, 1, 2)); }
        if (d.stage === 1 && d.buf.length >= 1) { expect(d.buf[0]).toBe(2); d.buf = d.buf.subarray(1); d.stage = 2; s.write(challenge); }
        if (d.stage === 2 && d.buf.length >= 16) {
          const ok = d.buf.subarray(0, 16).equals(vncResponse(password, challenge)); d.buf = d.buf.subarray(16);
          s.write(Uint8Array.of(0, 0, 0, ok ? 0 : 1)); if (!ok) { s.end(); return; } d.stage = 3;
        }
        if (d.stage === 3 && d.buf.length) { got.push(d.buf); d.buf = Buffer.alloc(0); s.write("SERVERINIT"); }
      },
    },
  });
  return { port: server.port, got, stop: () => server.stop(true) };
}
function viewer() {
  const sent: Buffer[] = []; let closed: number | undefined;
  return { sink: { send: (b: Uint8Array) => { sent.push(Buffer.from(b)); }, close: (code?: number) => { closed = code; } }, sent, closed: () => closed };
}
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await Bun.sleep(10); };

describe("vnc bridge", () => {
  test("passwords are 8 alphanumerics and differ per call", () => {
    expect(vncPassword()).toMatch(/^[A-Za-z0-9]{8}$/); expect(vncPassword()).not.toBe(vncPassword());
  });
  test("the server answers the VNC challenge; the browser is offered no-auth; then bytes are copied both ways", async () => {
    const vnc = fakeVncServer("s3cretPw"), v = viewer();
    const bridge = await openVncBridge({ port: vnc.port, password: "s3cretPw", viewer: v.sink });
    try {
      expect(v.sent[0]!.toString()).toBe("RFB 003.008\n");
      bridge.fromViewer(Buffer.from("RFB 003.008\n"));
      expect([...v.sent[1]!]).toEqual([1, 1]); // one security type: None
      bridge.fromViewer(Uint8Array.of(1, 1)); // chooses None, then ClientInit (shared) in the same frame
      expect([...v.sent[2]!]).toEqual([0, 0, 0, 0]);
      await until(() => v.sent.length > 3);
      expect([...vnc.got[0]!]).toEqual([1]);
      expect(v.sent[3]!.toString()).toBe("SERVERINIT");
      expect(Buffer.concat(v.sent).includes(Buffer.from("s3cretPw"))).toBe(false);
    } finally { bridge.close(); vnc.stop(); }
  });
  test("a wrong password fails before the browser sees anything", async () => {
    const vnc = fakeVncServer("right123"), v = viewer();
    await expect(openVncBridge({ port: vnc.port, password: "wrong123", viewer: v.sink, timeoutMs: 2000 })).rejects.toThrow();
    expect(v.sent).toHaveLength(0);
    vnc.stop();
  });
  test("a browser that picks another security type is disconnected", async () => {
    const vnc = fakeVncServer("pw"), v = viewer();
    const bridge = await openVncBridge({ port: vnc.port, password: "pw", viewer: v.sink });
    bridge.fromViewer(Buffer.from("RFB 003.008\n")); bridge.fromViewer(Uint8Array.of(2));
    expect(v.closed()).toBe(1008);
    vnc.stop();
  });
});
