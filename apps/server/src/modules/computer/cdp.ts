/**
 * Minimal Chrome DevTools Protocol client over Bun's native WebSocket. Used for browsers running in containers
 * (Playwright's `ws` transport does not connect reliably under Bun). Only what Zetta needs: navigate, screenshot, mouse/keyboard,
 * text extraction, and request interception for the address policy.
 */
import { FOCUSED_JS, type FocusedInput } from "./page-scripts";
export interface PageLike {
  goto(url: string): Promise<void>;
  click(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  wheel(dy: number): Promise<void>;
  clickText(text: string): Promise<void>;
  text(): Promise<string>;
  hasPassword(): Promise<boolean>;
  /** The element that has keyboard focus (through open shadow roots), described without its value. */
  focused(): Promise<FocusedInput | null>;
  screenshot(): Promise<Buffer>;
  url(): string;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Tab: { code: "Tab", vk: 9 },
  Escape: { code: "Escape", vk: 27 },
  Backspace: { code: "Backspace", vk: 8 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  PageDown: { code: "PageDown", vk: 34 },
  PageUp: { code: "PageUp", vk: 33 },
  Space: { code: "Space", vk: 32, text: " " },
};

export type CdpOptions = {
  wsUrl: string;
  allow: (url: string) => Promise<boolean>;
  viewport?: { width: number; height: number };
};

export async function connectCdp(
  o: CdpOptions,
): Promise<{ page: PageLike; close: () => Promise<void> }> {
  const ws = new WebSocket(o.wsUrl);
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("cdp connect timeout")), 10_000);
    ws.onopen = () => {
      clearTimeout(t);
      res();
    };
    ws.onerror = () => {
      clearTimeout(t);
      rej(new Error("cdp connect failed"));
    };
  });
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, ((p: any, sessionId?: string) => void)[]>();
  let currentUrl = "about:blank";
  let closed = false;
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message ?? "cdp error"));
      else p.resolve(m.result);
    } else if (m.method) for (const l of listeners.get(m.method) ?? []) l(m.params, m.sessionId);
  };
  ws.onclose = () => {
    closed = true;
    for (const p of pending.values()) p.reject(new Error("cdp closed"));
    pending.clear();
  };
  const send = <T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error("cdp closed"));
      const id = nextId++;
      pending.set(id, { resolve: resolve as never, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`cdp timeout ${method}`));
      }, 30_000);
    });
  const on = (method: string, fn: (p: any, sessionId?: string) => void) => {
    listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  };
  const once = (method: string, ms: number) =>
    new Promise<void>((res) => {
      const t = setTimeout(res, ms);
      on(method, () => {
        clearTimeout(t);
        res();
      });
    });

  const { targetInfos } = await send<{ targetInfos: { targetId: string; type: string }[] }>(
    "Target.getTargets",
  );
  const targetId =
    targetInfos.find((t) => t.type === "page")?.targetId ??
    (await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
  const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const s = <T = any>(method: string, params: object = {}) => send<T>(method, params, sessionId);
  await Promise.all([s("Page.enable"), s("Runtime.enable"), s("Network.enable")]);
  await s("Emulation.setDeviceMetricsOverride", {
    width: o.viewport?.width ?? 1024,
    height: o.viewport?.height ?? 640,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Address policy: every request (navigation, subresources, redirects) is checked before it leaves the container.
  await s("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  // Popups, new tabs and out-of-process iframes get the same interception before they can run (auto-attach, paused until Fetch is on).
  await s("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });
  on("Target.attachedToTarget", async (p) => {
    const sid = p.sessionId as string;
    try {
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sid);
      await send(
        "Target.setAutoAttach",
        { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
        sid,
      );
      await send("Runtime.runIfWaitingForDebugger", {}, sid);
    } catch {
      /* target already gone */
    }
  });
  on("Fetch.requestPaused", async (p, sid) => {
    let ok = false;
    try {
      ok = await o.allow(p.request.url);
    } catch {
      ok = false;
    }
    try {
      await send(
        ok ? "Fetch.continueRequest" : "Fetch.failRequest",
        ok
          ? { requestId: p.requestId }
          : { requestId: p.requestId, errorReason: "BlockedByClient" },
        sid,
      );
    } catch {
      /* page gone */
    }
  });
  on("Page.frameNavigated", (p) => {
    if (!p.frame.parentId) currentUrl = p.frame.url;
  });
  const evalJs = async <T = unknown>(expression: string): Promise<T> => {
    const r = await s<{ result: { value: T }; exceptionDetails?: unknown }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error("eval failed");
    return r.result.value;
  };
  const mouse = async (type: string, x: number, y: number, extra: object = {}) =>
    s("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });

  const page: PageLike = {
    async goto(url) {
      const loaded = once("Page.domContentEventFired", 20_000);
      const r = await s<{ errorText?: string }>("Page.navigate", { url });
      if (r.errorText) throw new Error("navigation failed");
      await loaded;
    },
    async click(x, y) {
      await mouse("mouseMoved", x, y);
      await mouse("mousePressed", x, y, { clickCount: 1 });
      await mouse("mouseReleased", x, y, { clickCount: 1 });
    },
    async type(text) {
      await s("Input.insertText", { text });
    },
    async press(key) {
      const k = KEYS[key];
      if (!k) {
        await s("Input.insertText", { text: key.slice(0, 1) });
        return;
      }
      await s("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key,
        code: k.code,
        windowsVirtualKeyCode: k.vk,
      });
      if (k.text) await s("Input.dispatchKeyEvent", { type: "char", key, text: k.text });
      await s("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: k.code,
        windowsVirtualKeyCode: k.vk,
      });
    },
    async wheel(dy) {
      await mouse("mouseWheel", 100, 100, { deltaX: 0, deltaY: dy });
    },
    async clickText(text) {
      const rect = await evalJs<{ x: number; y: number } | null>(
        `(() => { const t = ${JSON.stringify(text.toLowerCase())}; const els = [...document.querySelectorAll('a,button,[role=button],input[type=submit],label,summary,li,span,div,p,h1,h2,h3')]; const hit = els.filter((e) => (e.innerText || e.value || '').toLowerCase().includes(t)).sort((a, b) => (a.innerText||'').length - (b.innerText||'').length)[0]; if (!hit) return null; hit.scrollIntoView({ block: 'center' }); const r = hit.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      if (!rect) throw new Error("not found");
      await page.click(rect.x, rect.y);
    },
    async text() {
      return (await evalJs<string>("document.body ? document.body.innerText : ''")) ?? "";
    },
    async hasPassword() {
      return (await evalJs<number>("document.querySelectorAll('input[type=password]').length")) > 0;
    },
    async focused() {
      return (await evalJs<FocusedInput | null>(FOCUSED_JS)) ?? null;
    },
    async screenshot() {
      return Buffer.from(
        (await s<{ data: string }>("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      );
    },
    url: () => currentUrl,
  };
  return {
    page,
    close: async () => {
      try {
        await send("Browser.close");
      } catch {
        /* already gone */
      }
      try {
        ws.close();
      } catch {
        /* closed */
      }
    },
  };
}

export type PageLinks = { url: string; links: { text: string; href: string }[] };
/** Page script for `pageLinks`: the address and the http(s) links that have a layout box, deduplicated, at most 150. */
export const LINKS_JS = `(() => { const seen = new Set(), links = []; for (const a of document.querySelectorAll('a[href]')) { const href = a.href; if (!/^https?:/.test(href) || seen.has(href)) continue; const r = a.getBoundingClientRect(); if (!r.width || !r.height) continue; seen.add(href);
  links.push({ text: (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\\s+/g, ' ').trim().slice(0, 120), href: href.slice(0, 400) }); if (links.length >= 150) break; } return { url: location.href, links }; })()`;

/**
 * Reads the address and the links of the page a VM's Chromium shows, over its DevTools port (docker/desktop publishes it on 127.0.0.1).
 * Read only and short-lived: one evaluate on the most recently active tab, then the socket closes; the browser and its tabs stay as they were.
 */
export async function pageLinks(port: number, timeoutMs = 5000): Promise<PageLinks> {
  const signal = AbortSignal.timeout(timeoutMs);
  // /json/list puts the most recently active tab first.
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`, { signal })
  ).json()) as { type: string; webSocketDebuggerUrl?: string }[];
  const target = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!target) throw new Error("no page");
  // The target names the port inside the container; the published one is on the host.
  const ws = new WebSocket(
    target.webSocketDebuggerUrl!.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`),
  );
  try {
    return await new Promise<PageLinks>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("cdp timeout")), timeoutMs);
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error("cdp connect failed"));
      };
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: { expression: LINKS_JS, returnByValue: true },
          }),
        );
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.id !== 1) return;
        clearTimeout(t);
        const v = m.result?.result?.value as PageLinks | undefined;
        if (m.error || m.result?.exceptionDetails || !v) reject(new Error("eval failed"));
        else resolve(v);
      };
    });
  } finally {
    try {
      ws.close();
    } catch {
      /* closed */
    }
  }
}

/** The browser refused the address (no DNS answer, connection refused, certificate error...): the message is Chromium's `net::ERR_*` code. */
export class NavigationError extends Error {}

export type NavigateResult = {
  url: string;
  loaded: boolean;
  /** The page's text stopped growing before `contentMs` ran out. False: it may still be drawing (a single-page app that fetches after load). */
  settled?: boolean;
};

type Send = (method: string, params?: object) => Promise<any>;
type OpenPage = { send: Send; onLoad: (fn: () => void) => void; close: () => void };

/**
 * Attaches to the most recently active page of a VM's Chromium over its DevTools port. Right after a cold start Chromium may not listen
 * yet or may not have its first tab: waits for a page target, up to `timeoutMs`. The caller closes it.
 */
async function openPage(
  port: number,
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<OpenPage> {
  const deadline = Date.now() + timeoutMs;
  let target: { type: string; webSocketDebuggerUrl?: string } | undefined;
  for (let last: unknown; !target; await Bun.sleep(250)) {
    if (signal?.aborted) throw new Error("cancelled");
    if (Date.now() > deadline) throw last instanceof Error ? last : new Error("no page");
    try {
      const list = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })
      ).json()) as { type: string; webSocketDebuggerUrl?: string }[];
      target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (!target) last = new Error("no page");
    } catch (e) {
      last = e;
    }
  }
  const ws = new WebSocket(
    target.webSocketDebuggerUrl!.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`),
  );
  const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let loadListener: () => void = () => {};
  const closeAll = (why: string) => {
    for (const p of pending.values()) p.reject(new Error(why));
    pending.clear();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    const p = m.id === undefined ? undefined : pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message ?? "cdp error"));
      else p.resolve(m.result);
    } else if (m.method === "Page.loadEventFired") loadListener();
  };
  ws.onclose = () => closeAll("cdp closed");
  const send: Send = (method, params = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const t = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`cdp timeout ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (r) => (clearTimeout(t), resolve(r)),
        reject: (e) => (clearTimeout(t), reject(e)),
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const close = () => {
    try {
      ws.close();
    } catch {
      /* closed */
    }
  };
  signal?.addEventListener("abort", close, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("cdp connect timeout")), timeoutMs);
      ws.onopen = () => (clearTimeout(t), resolve());
      ws.onerror = () => (clearTimeout(t), reject(new Error("cdp connect failed")));
    });
  } catch (e) {
    close();
    throw e;
  }
  return { send, onLoad: (fn) => (loadListener = fn), close };
}

/** Page script for `waitForContent`: how much text the page shows and whether the document finished loading. */
export const CONTENT_JS = `(() => ({ ready: document.readyState, len: document.body ? document.body.innerText.length : 0 }))()`;

/**
 * Waits until the page's text stops changing. The load event fires on a single-page app's empty shell (X, for one): the content is drawn
 * after it, and a read taken right then holds a header and no posts. Polls every 300 ms; settled = the document is complete, has text, and
 * the text length was the same on two polls in a row. A page that never settles (an endless feed) returns false when `maxMs` ends.
 */
async function waitForContent(send: Send, maxMs: number): Promise<boolean> {
  const end = Date.now() + maxMs;
  let last = -1,
    same = 0;
  while (Date.now() < end) {
    const r = await send("Runtime.evaluate", { expression: CONTENT_JS, returnByValue: true }).catch(
      () => undefined,
    );
    const v = r?.result?.value as { ready?: string; len?: number } | undefined;
    if (v && typeof v.len === "number") {
      same = v.len === last ? same + 1 : 0;
      last = v.len;
      if (v.ready === "complete" && v.len > 0 && same >= 2) return true;
    }
    await Bun.sleep(300);
  }
  return false;
}

/**
 * Opens `url` in the most recently active tab of a VM's Chromium over its DevTools port and waits for the load event, so the caller knows
 * the tab left about:blank, then for the page's text to stop growing (`settled`). Unlike `connectCdp` it only attaches to the tab (no request
 * interception, no viewport override): the window is the one the user sees. A page that is still loading after `loadMs` answers
 * `loaded: false` with the address it is on.
 */
export async function navigatePage(
  port: number,
  url: string,
  o: { timeoutMs?: number; loadMs?: number; contentMs?: number; signal?: AbortSignal } = {},
): Promise<NavigateResult> {
  const { timeoutMs = 10_000, loadMs = 15_000, contentMs = 6000, signal } = o;
  const page = await openPage(port, { timeoutMs, signal });
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await page.send("Page.enable");
    // Listen before navigating: the load event may arrive right behind the answer to Page.navigate.
    const loaded = new Promise<boolean>((resolve) => {
      page.onLoad(() => resolve(true));
      loadTimer = setTimeout(() => resolve(false), loadMs);
    });
    const r = await page.send("Page.navigate", { url });
    if (r?.errorText) throw new NavigationError(String(r.errorText));
    const done = await loaded;
    const settled = done ? await waitForContent(page.send, contentMs) : false;
    const at = await page.send("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    return { url: String(at?.result?.value ?? url), loaded: done, settled };
  } finally {
    clearTimeout(loadTimer);
    page.close();
  }
}

/**
 * Waits for the page the VM's Chromium shows to finish drawing, without navigating or touching it: one short attach to the active tab,
 * then the socket closes. A read right after a navigate, a click or a scroll gets the content instead of the shell. Resolves false when
 * the page was still changing after `maxMs`.
 */
export async function settlePage(
  port: number,
  o: { maxMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const { maxMs = 3000, signal } = o;
  const page = await openPage(port, { timeoutMs: 2000, signal });
  try {
    return await waitForContent(page.send, maxMs);
  } finally {
    page.close();
  }
}
