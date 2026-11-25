import { Elysia } from "elysia";
import type { PhoneCalls, PhoneStreamHandle, WebhookResult } from "./calls";
import { TWILIO_STATUS_PATH, TWILIO_VOICE_PATH } from "./twilio";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_FRAME_BYTES = 128 * 1024;

/**
 * - `POST /api/phone/webhook` and `/api/phone/webhook/:owner`: Telnyx's events (the second is the address of a person's own Telnyx account: the id is only
 *   used to pick the key that checks the signature, never trusted for anything else) (a call rings, was answered, a key was pressed, it ended). No session and no origin:
 *   the signature of the raw body, its age and its id are checked (`calls.webhook`); every refusal is the same short answer.
 * - `POST /api/phone/twilio/voice` and `/api/phone/twilio/status` (and the same with `/:owner`, the addresses of a person's own Twilio account): Twilio's webhooks (form encoded, signed over the address and the
 *   parameters). The voice one is answered with TwiML (the call's answer); the status one carries call status and machine detection.
 * - `GET  /api/phone/stream?token=`: the WebSocket the provider opens with a call's audio. The one-time token, made when the call was
 *   answered, is the credential: in the address for Telnyx, in the stream's `start` message for Twilio (its address takes no query).
 *   Browsers never use it, so there is no Origin to check.
 * All are worker-only (worker-only.ts, docker/scale/Caddyfile): the call and its turn live in the process that answered it.
 */
export function createPhoneCallRoutes(calls: PhoneCalls) {
  const sockets = new Map<object, PhoneStreamHandle | null>();
  const answer = (res: WebhookResult) =>
    res.xml
      ? new Response(res.xml, {
          status: res.status,
          headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
        })
      : Response.json(res.body, { status: res.status, headers: { "cache-control": "no-store" } });
  const hook =
    (provider: "telnyx" | "twilio", path?: string) =>
    async ({ request, params }: { request: Request; params?: { owner?: string } }) => {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES)
        return Response.json({ error: { code: "TOO_LARGE" } }, { status: 413 });
      const raw = await request.text();
      if (raw.length > MAX_WEBHOOK_BYTES)
        return Response.json({ error: { code: "TOO_LARGE" } }, { status: 413 });
      const owner = params?.owner;
      return answer(
        await calls.webhook(raw, request.headers, {
          provider,
          // Twilio signs the whole address, so a person's own address is part of the path that is checked.
          path: path && owner ? `${path}/${encodeURIComponent(owner)}` : path,
          ...(owner ? { ownerUserId: owner } : {}),
        }),
      );
    };
  return new Elysia({ prefix: "/api/phone", normalize: false })
    .post("/webhook", hook("telnyx"), { parse: "none" })
    .post("/webhook/:owner", hook("telnyx"), { parse: "none" })
    .post("/twilio/voice", hook("twilio", TWILIO_VOICE_PATH), { parse: "none" })
    .post("/twilio/status", hook("twilio", TWILIO_STATUS_PATH), { parse: "none" })
    .post("/twilio/voice/:owner", hook("twilio", TWILIO_VOICE_PATH), { parse: "none" })
    .post("/twilio/status/:owner", hook("twilio", TWILIO_STATUS_PATH), { parse: "none" })
    .ws("/stream", {
      idleTimeout: 960,
      sendPings: true,
      maxPayloadLength: MAX_FRAME_BYTES,
      open(ws) {
        const token = String((ws.data.query as Record<string, unknown>).token ?? "");
        const socket = {
          send: (text: string) => void ws.raw.send(text),
          close: (code: number, reason: string) => ws.raw.close(code, reason.slice(0, 100)),
          ping: () => void ws.raw.ping(),
        };
        // No token in the address: the provider sends it in the stream's first message (Twilio).
        sockets.set(ws.raw, token ? calls.open(token, socket) : calls.openUnnamed(socket));
      },
      message(ws, message) {
        sockets
          .get(ws.raw)
          ?.message(typeof message === "string" ? message : JSON.stringify(message));
      },
      close(ws) {
        const handle = sockets.get(ws.raw);
        sockets.delete(ws.raw);
        handle?.closed();
      },
    }) as unknown as Elysia;
}
