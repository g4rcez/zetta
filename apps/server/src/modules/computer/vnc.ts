import { createCipheriv, randomBytes } from "node:crypto";

/**
 * VNC (RFB 3.8) bridge between a browser viewer (noVNC over a WebSocket) and a VM's x11vnc on a loopback-published port.
 * The server answers the VM's VNC-password challenge itself, then tells the browser "no authentication", so the per-start VNC
 * password never leaves the server; after that both directions are copied byte for byte.
 */
const VERSION = Buffer.from("RFB 003.008\n");
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const reverseBits = (b: number) => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };

/** VNC passwords are at most 8 characters (a DES key); 8 random alphanumerics per start. */
export const vncPassword = () => [...randomBytes(8)].map((b) => ALNUM[b % ALNUM.length]).join("");

/** RFB "VNC authentication": the challenge DES-encrypted with the password (bits of each byte reversed) as key. */
export function vncResponse(password: string, challenge: Uint8Array) {
  const key = Buffer.alloc(8);
  for (let i = 0; i < Math.min(8, password.length); i++) key[i] = reverseBits(password.charCodeAt(i) & 0xff);
  const c = createCipheriv("des-ecb", key, null); c.setAutoPadding(false);
  return Buffer.concat([c.update(challenge), c.final()]);
}

export type VncBridge = { fromViewer(data: Uint8Array): void; close(): void };
type Sink = { send(data: Uint8Array): void; close(code?: number, reason?: string): void };

/** Connects to the VM's VNC server, authenticates, and only then starts the browser's handshake. Rejects if the VM refuses. */
export async function openVncBridge(o: { port: number; password: string; viewer: Sink; host?: string; timeoutMs?: number }): Promise<VncBridge> {
  let buf = Buffer.alloc(0), wait: (() => void) | undefined, ended = false, piping = false, done = false;
  const pending: Uint8Array[] = [];
  const socket = await Bun.connect({
    hostname: o.host ?? "127.0.0.1", port: o.port,
    socket: {
      data(_s, chunk) { if (piping) o.viewer.send(chunk); else { buf = Buffer.concat([buf, chunk]); wait?.(); } },
      drain(s) { while (pending.length) { const c = pending[0]!; const n = s.write(c); if (n < c.length) { pending[0] = c.subarray(Math.max(0, n)); return; } pending.shift(); } },
      close() { ended = true; wait?.(); if (!done) { done = true; o.viewer.close(1000, "The computer closed the connection."); } },
      error() { ended = true; wait?.(); },
    },
  });
  const write = (c: Uint8Array) => { if (pending.length) { pending.push(c); return; } const n = socket.write(c); if (n < c.length) pending.push(c.subarray(Math.max(0, n))); };
  const deadline = Date.now() + (o.timeoutMs ?? 10_000);
  const read = async (n: number) => {
    while (buf.length < n) {
      if (ended || Date.now() > deadline) throw new Error("vnc handshake failed");
      await new Promise<void>((r) => { wait = r; setTimeout(r, 250); }); wait = undefined;
    }
    const out = buf.subarray(0, n); buf = buf.subarray(n); return out;
  };
  try {
    if (!(await read(12)).toString().startsWith("RFB 003.")) throw new Error("not a VNC server");
    write(VERSION);
    const count = (await read(1))[0]!;
    if (count === 0) throw new Error("vnc server refused");
    const types = [...(await read(count))];
    if (types.includes(2)) { write(Uint8Array.of(2)); write(vncResponse(o.password, await read(16))); }
    else if (types.includes(1)) write(Uint8Array.of(1));
    else throw new Error("no supported vnc security type");
    if ((await read(4)).readUInt32BE(0) !== 0) throw new Error("vnc password rejected");
  } catch (e) { done = true; socket.end(); throw e; }

  // Browser side: our version, then a single security type "None" (1) and SecurityResult OK; everything after is ClientInit onward.
  let stage: "version" | "security" | "pipe" = "version", head = Buffer.alloc(0);
  o.viewer.send(VERSION);
  return {
    fromViewer(data) {
      if (stage === "pipe") { write(data); return; }
      head = Buffer.concat([head, data]);
      if (stage === "version" && head.length >= 12) { head = head.subarray(12); stage = "security"; o.viewer.send(Uint8Array.of(1, 1)); }
      if (stage === "security" && head.length >= 1) {
        if (head[0] !== 1) { done = true; o.viewer.close(1008, "Unsupported VNC security type."); socket.end(); return; }
        head = head.subarray(1); stage = "pipe"; piping = true;
        o.viewer.send(Uint8Array.of(0, 0, 0, 0));
        if (buf.length) { o.viewer.send(buf); buf = Buffer.alloc(0); }
        if (head.length) write(head);
      }
    },
    close() { ended = true; done = true; socket.end(); },
  };
}
