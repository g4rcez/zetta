import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
const { useFollowQueued } = await import("./use-follow-queued");
const { setLive } = await import("@/lib/query-policy");

const roots: ReturnType<typeof createRoot>[] = [];
const realSetInterval = globalThis.setInterval;
afterEach(async () => {
  globalThis.setInterval = realSetInterval;
  setLive(false);
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.innerHTML = "";
});

type Props = { waiting: boolean; busy: boolean; updatedAt: number };
/** Mounts the hook and returns a way to change its inputs, plus what it did: the delays of the timers it set and how often it re-attached. */
async function mount(first: Props) {
  const delays: number[] = [];
  globalThis.setInterval = ((fn: () => void, ms?: number) => {
    delays.push(Number(ms));
    return realSetInterval(fn, 1_000_000); // never fires during the test
  }) as never;
  const log = { reattach: 0, reload: 0 };
  // Stable, as the pages' `useCallback` is: a new function would restart the timer effect on every render.
  const reload = () => {
    log.reload += 1;
  };
  function Probe(p: Props) {
    useFollowQueued(
      "c1",
      p.waiting,
      {
        busy: p.busy,
        reattach: () => {
          log.reattach += 1;
        },
      },
      reload,
      p.updatedAt,
    );
    return null;
  }
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  const render = (p: Props) => act(async () => root.render(<Probe {...p} />));
  await render(first);
  return { render, delays, log };
}

test("without the live channel the safety timer runs every 2 s", async () => {
  const { delays } = await mount({ waiting: true, busy: false, updatedAt: 1 });
  expect(delays).toEqual([2_000]);
});

test("with the live channel the timer is only a 15 s safety net", async () => {
  setLive(true);
  const { delays } = await mount({ waiting: true, busy: false, updatedAt: 1 });
  expect(delays).toEqual([15_000]);
});

test("a messages update the channel brought re-attaches to the answer that just started", async () => {
  setLive(true);
  const { render, log } = await mount({ waiting: true, busy: false, updatedAt: 1 });
  expect(log.reattach).toBe(1); // on mount
  await render({ waiting: true, busy: false, updatedAt: 2 });
  expect(log.reattach).toBe(2);
  expect(log.reload).toBe(0); // the channel already refetched the messages: no extra request
});

test("nothing re-attaches while no message waits or a stream is already attached", async () => {
  const idle = await mount({ waiting: false, busy: false, updatedAt: 1 });
  await idle.render({ waiting: false, busy: false, updatedAt: 2 });
  expect(idle.log.reattach).toBe(0);
  expect(idle.delays).toEqual([]);
  const attached = await mount({ waiting: true, busy: true, updatedAt: 1 });
  await attached.render({ waiting: true, busy: true, updatedAt: 2 });
  expect(attached.log.reattach).toBe(0);
});
