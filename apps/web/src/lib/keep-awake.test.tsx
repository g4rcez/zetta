import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();
// The shared fake browser has no storage; the app reads it as a bare global.
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: win.localStorage });
afterAll(() => void delete (globalThis as Record<string, unknown>).localStorage);

type Lock = { released: boolean; release: () => Promise<void>; addEventListener: () => void };
const locks: Lock[] = [];
Object.defineProperty(win.navigator, "wakeLock", {
  configurable: true,
  value: {
    request: async () => {
      const lock: Lock = {
        released: false,
        release: async () => void (lock.released = true),
        addEventListener: () => undefined,
      };
      locks.push(lock);
      return lock;
    },
  },
});

const { setChatKeepAwake, setKeepAwake, useChatKeepAwake, useKeepAwake, useWakeLock } =
  await import("./keep-awake");

function Probe({ chat, active }: { chat: string; active: boolean }) {
  const mode = useKeepAwake();
  const chatMode = useChatKeepAwake(chat);
  const state = useWakeLock(active);
  return <output>{`${mode}|${chatMode}|${state}`}</output>;
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

test("settings are stored per device and per chat, and the lock follows `active`", async () => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<Probe chat="c1" active={false} />));
  expect(host.textContent).toBe("chats|off|idle");

  await act(async () => setChatKeepAwake("c1", "on"));
  await act(async () => setKeepAwake("all"));
  expect(host.textContent).toBe("all|on|idle");
  await act(async () => setChatKeepAwake("c1", "off"));
  expect(host.textContent).toBe("all|off|idle");

  await act(async () => root.render(<Probe chat="c1" active />));
  await flush();
  expect(host.textContent).toBe("all|off|held");
  const live = locks.filter((l) => !l.released);
  expect(live).toHaveLength(1);

  await act(async () => root.render(<Probe chat="c1" active={false} />));
  expect(locks.every((l) => l.released)).toBe(true);
  expect(host.textContent).toBe("all|off|idle");
  await act(async () => root.unmount());
});
