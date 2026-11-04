import { Elysia } from "elysia";

import { AccessError, type createIdentityAccess } from "../identity/access";
import type { EventBus } from "./bus";
import { fail } from "../http-response";

export type EventServices = {
  access: ReturnType<typeof createIdentityAccess>;
  bus: EventBus;
};

/** One person with many tabs open is normal; this stops a loop from holding the process's sockets. */
const MAX_STREAMS_PER_USER = 10;

export function createEventRoutes(
  { access, bus }: EventServices,
  _trustedOrigins: readonly string[],
) {
  return new Elysia({ prefix: "/api/events", normalize: false }).get("/", async ({ request }) => {
    try {
      const actor = await access.requireActive(request.headers);
      if (bus.count(actor.userId) >= MAX_STREAMS_PER_USER)
        return fail(429, "TOO_MANY_STREAMS", "Close another Zetta tab and try again.");
      const encoder = new TextEncoder();
      let beat: ReturnType<typeof setInterval> | undefined;
      let stop = () => {};
      return new Response(
        new ReadableStream({
          start(controller) {
            const send = (frame: string) => {
              try {
                controller.enqueue(encoder.encode(frame));
              } catch {
                /* closed */
              }
            };
            send(": ok\n\n"); // the browser reports the stream as open when the first bytes arrive
            // A comment frame keeps proxies and the server's idle timeout from closing a quiet stream.
            beat = setInterval(
              () => send(": ping\n\n"),
              Number(process.env.ZETTA_SSE_HEARTBEAT_MS ?? 30_000),
            );
            stop = bus.subscribe(actor.userId, (topic) =>
              send(`data: ${JSON.stringify({ topic })}\n\n`),
            );
          },
          cancel() {
            clearInterval(beat);
            stop();
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        },
      );
    } catch (e) {
      if (e instanceof AccessError)
        return fail(
          e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403,
          e.code,
          e.message,
        );
      return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
    }
  });
}
