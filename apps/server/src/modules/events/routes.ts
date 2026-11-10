import { Elysia } from "elysia";

import { AccessError, type createIdentityAccess } from "../identity/access";
import type { EventBus } from "./bus";
import { accessFail, fail } from "../http-response";
import { envNumber } from "../env-number";

export type EventServices = {
  access: ReturnType<typeof createIdentityAccess>;
  bus: EventBus;
};

/**
 * One person with many tabs open is normal; this stops a loop from holding the process's sockets. Past it, the oldest stream is
 * closed (with an `evicted` event) instead of refusing the new one, so the tab the person is looking at always gets a stream.
 */
const MAX_STREAMS_PER_USER = 10;

export function createEventRoutes(
  { access, bus }: EventServices,
  _trustedOrigins: readonly string[],
) {
  return new Elysia({ prefix: "/api/events", normalize: false }).get("/", async ({ request }) => {
    try {
      const actor = await access.requireActive(request.headers);
      const encoder = new TextEncoder();
      let beat: ReturnType<typeof setInterval> | undefined;
      let stop = () => {};
      let close = () => {};
      let ended = false;
      // Idempotent: runs on cancel, on an aborted request (a dropped socket frees its slot at once) and on eviction.
      const end = () => {
        if (ended) return;
        ended = true;
        clearInterval(beat);
        stop();
        close();
      };
      request.signal.addEventListener("abort", end, { once: true });
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
            close = () => {
              try {
                controller.close();
              } catch {
                /* closed */
              }
            };
            // The browser reports the stream as open when the first bytes arrive; `retry` sets its own reconnect delay.
            send("retry: 5000\n: ok\n\n");
            // A comment frame keeps proxies and the server's idle timeout from closing a quiet stream.
            beat = setInterval(
              () => send(": ping\n\n"),
              envNumber(process.env.ZETTA_SSE_HEARTBEAT_MS, 30_000),
            );
            stop = bus.subscribe(
              actor.userId,
              (topic) => send(`data: ${JSON.stringify({ topic })}\n\n`),
              {
                max: MAX_STREAMS_PER_USER,
                onEvict: () => {
                  send("event: evicted\ndata: {}\n\n");
                  end();
                },
              },
            );
            if (request.signal.aborted) end();
          },
          cancel: end,
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
      if (e instanceof AccessError) return accessFail(e);
      return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
    }
  });
}
