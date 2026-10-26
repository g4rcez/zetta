/**
 * Minimal Chrome DevTools Protocol client over Bun's native WebSocket. Used for browsers running in containers
 * (Playwright's `ws` transport does not connect reliably under Bun). Only what Zetta needs: navigate, screenshot, mouse/keyboard,
 * text extraction, and request interception for the address policy.
 */
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

export type FocusedInput = { tag: string; type: string; autocomplete: string; name: string; inputmode: string };
/** Page script for `focused()`: never reads the element's value. */
export const FOCUSED_JS = `(() => { let e = document.activeElement; while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement; if (!e || e === document.body) return null;
  const a = (k) => String(e.getAttribute(k) || '').toLowerCase().slice(0, 80);
  return { tag: e.tagName.toLowerCase(), type: e.tagName === 'INPUT' ? String(e.type || 'text').toLowerCase() : '', autocomplete: a('autocomplete'), name: [a('name'), a('id'), a('aria-label'), a('placeholder')].join(' ').trim(), inputmode: a('inputmode') }; })()`;

type Pending ={ resolve: (v: unknown) => void; reject: (e: Error) => void };
const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: "Enter", vk: 13, text: "\r" }, Tab: { code: "Tab", vk: 9 }, Escape: { code: "Escape", vk: 27 }, Backspace: { code: "Backspace", vk: 8 },
  ArrowDown: { code: "ArrowDown", vk: 40 }, ArrowUp: { code: "ArrowUp", vk: 38 }, ArrowLeft: { code: "ArrowLeft", vk: 37 }, ArrowRight: { code: "ArrowRight", vk: 39 },
  PageDown: { code: "PageDown", vk: 34 }, PageUp: { code: "PageUp", vk: 33 }, Space: { code: "Space", vk: 32, text: " " },
};

export type CdpOptions = { wsUrl: string; allow: (url: string) => Promise<boolean>; viewport?: { width: number; height: number } };

export async function connectCdp(o: CdpOptions): Promise<{ page: PageLike; close: () => Promise<void> }> {
  const ws = new WebSocket(o.wsUrl);
  await new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error("cdp connect timeout")), 10_000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error("cdp connect failed")); }; });
  let nextId = 1; const pending = new Map<number, Pending>(); const listeners = new Map<string, ((p: any, sessionId?: string) => void)[]>();
  let currentUrl = "about:blank"; let closed = false;
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id)!; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message ?? "cdp error")) : p.resolve(m.result); }
    else if (m.method) for (const l of listeners.get(m.method) ?? []) l(m.params, m.sessionId);
  };
  ws.onclose = () => { closed = true; for (const p of pending.values()) p.reject(new Error("cdp closed")); pending.clear(); };
  const send = <T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> => new Promise((resolve, reject) => {
    if (closed) return reject(new Error("cdp closed"));
    const id = nextId++; pending.set(id, { resolve: resolve as never, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`cdp timeout ${method}`)); }, 30_000);
  });
  const on = (method: string, fn: (p: any, sessionId?: string) => void) => { listeners.set(method, [...(listeners.get(method) ?? []), fn]); };
  const once = (method: string, ms: number) => new Promise<void>((res) => { const t = setTimeout(res, ms); on(method, () => { clearTimeout(t); res(); }); });

  const { targetInfos } = await send<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets");
  const targetId = targetInfos.find((t) => t.type === "page")?.targetId ?? (await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
  const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const s = <T = any>(method: string, params: object = {}) => send<T>(method, params, sessionId);
  await Promise.all([s("Page.enable"), s("Runtime.enable"), s("Network.enable")]);
  await s("Emulation.setDeviceMetricsOverride", { width: o.viewport?.width ?? 1024, height: o.viewport?.height ?? 640, deviceScaleFactor: 1, mobile: false });
  // Address policy: every request (navigation, subresources, redirects) is checked before it leaves the container.
  await s("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  // Popups, new tabs and out-of-process iframes get the same interception before they can run (auto-attach, paused until Fetch is on).
  await s("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  on("Target.attachedToTarget", async (p) => {
    const sid = p.sessionId as string;
    try {
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sid);
      await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid);
      await send("Runtime.runIfWaitingForDebugger", {}, sid);
    } catch { /* target already gone */ }
  });
  on("Fetch.requestPaused", async (p, sid) => {
    let ok = false; try { ok = await o.allow(p.request.url); } catch { ok = false; }
    try { await send(ok ? "Fetch.continueRequest" : "Fetch.failRequest", ok ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: "BlockedByClient" }, sid); } catch { /* page gone */ }
  });
  on("Page.frameNavigated", (p) => { if (!p.frame.parentId) currentUrl = p.frame.url; });
  const evalJs = async <T = unknown>(expression: string): Promise<T> => {
    const r = await s<{ result: { value: T }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval failed");
    return r.result.value;
  };
  const mouse = async (type: string, x: number, y: number, extra: object = {}) => s("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });

  const page: PageLike = {
    async goto(url) {
      const loaded = once("Page.domContentEventFired", 20_000);
      const r = await s<{ errorText?: string }>("Page.navigate", { url });
      if (r.errorText) throw new Error("navigation failed");
      await loaded;
    },
    async click(x, y) { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, { clickCount: 1 }); await mouse("mouseReleased", x, y, { clickCount: 1 }); },
    async type(text) { await s("Input.insertText", { text }); },
    async press(key) {
      const k = KEYS[key]; if (!k) { await s("Input.insertText", { text: key.slice(0, 1) }); return; }
      await s("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: k.code, windowsVirtualKeyCode: k.vk });
      if (k.text) await s("Input.dispatchKeyEvent", { type: "char", key, text: k.text });
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, code: k.code, windowsVirtualKeyCode: k.vk });
    },
    async wheel(dy) { await mouse("mouseWheel", 100, 100, { deltaX: 0, deltaY: dy }); },
    async clickText(text) {
      const rect = await evalJs<{ x: number; y: number } | null>(`(() => { const t = ${JSON.stringify(text.toLowerCase())}; const els = [...document.querySelectorAll('a,button,[role=button],input[type=submit],label,summary,li,span,div,p,h1,h2,h3')]; const hit = els.filter((e) => (e.innerText || e.value || '').toLowerCase().includes(t)).sort((a, b) => (a.innerText||'').length - (b.innerText||'').length)[0]; if (!hit) return null; hit.scrollIntoView({ block: 'center' }); const r = hit.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!rect) throw new Error("not found");
      await page.click(rect.x, rect.y);
    },
    async text() { return (await evalJs<string>("document.body ? document.body.innerText : ''")) ?? ""; },
    async hasPassword() { return (await evalJs<number>("document.querySelectorAll('input[type=password]').length")) > 0; },
    async focused() { return (await evalJs<FocusedInput | null>(FOCUSED_JS)) ?? null; },
    async screenshot() { return Buffer.from((await s<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"); },
    url: () => currentUrl,
  };
  return { page, close: async () => { try { await send("Browser.close"); } catch { /* already gone */ } try { ws.close(); } catch { /* closed */ } } };
}
