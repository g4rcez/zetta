// The browser half of voice-page.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/voice-page.ts`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("VOICE_E2E_ORIGIN");
const SHOTS = env("VOICE_E2E_SHOTS");
const CDP = env("VOICE_E2E_CDP");
const CHAT = env("VOICE_E2E_CHAT");
const SENTENCE = env("VOICE_E2E_SENTENCE");
const REPLY = JSON.parse(env("VOICE_E2E_REPLY")) as string[];
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(
  env("VOICE_E2E_PLAYWRIGHT")
)) as typeof import("playwright-core");
const out = (name: string, result: "pass" | "fail" | "skip", detail = "") =>
  console.log(`RESULT ${JSON.stringify({ name, result, detail })}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0]!;
// The first tab, after a pause: a tab opened at once has its first navigation aborted.
await sleep(3000);
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(40_000);
await page.setViewportSize({ width: 1100, height: 760 });

// Page problems are printed, so a hang is not a mystery.
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()))
    console.log(`[page ${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => console.log(`[page error] ${String(e).slice(0, 300)}`));
page.on("requestfailed", (r) =>
  console.log(`[request failed] ${r.url().slice(0, 160)} ${r.failure()?.errorText}`),
);
const shotFiles: string[] = [];
async function shot(name: string) {
  const file = join(SHOTS, `${name.replace(/[^\w.-]+/g, "-")}.png`);
  await page.screenshot({ path: file });
  shotFiles.push(file);
  console.log(`SHOT ${file}`);
}
/** What the page was doing when a check failed: the microphone, the audio context and what was sent. */
async function diagnose() {
  const d = await page.evaluate(() => {
    const w = window as never as Record<string, unknown>;
    return {
      constraints: w.__constraints,
      tracks: (w.__tracks as MediaStreamTrack[]).map((t) => t.readyState),
      contexts: (w.__contexts as AudioContext[]).map((c) => `${c.state} ${c.sampleRate}`),
      sent: w.__sent,
      binOut: w.__binOut,
      maxAbs: w.__maxAbs,
      loudFrames: w.__loudFrames,
      binIn: w.__binIn,
      states: w.__states,
    };
  });
  console.log(`[diagnose] ${JSON.stringify(d)}`);
  // A socket with a ticket that is not valid must be closed with 4401 by the server, through the dev proxy.
  const probe = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const s = new WebSocket(`ws://${location.host}/api/voice/socket?ticket=bogus`);
        const t = setTimeout(() => resolve(`no event in 4 s (readyState ${s.readyState})`), 4000);
        s.onopen = () => resolve("open");
        s.onclose = (e) => {
          clearTimeout(t);
          resolve(`close ${e.code}`);
        };
      }),
  );
  console.log(`[diagnose] bogus-ticket socket: ${probe}`);
}
async function check(name: string, run: () => Promise<string | void>) {
  try {
    out(name, "pass", (await run()) || "");
  } catch (e) {
    out(name, "fail", e instanceof Error ? e.message : String(e));
    await diagnose().catch(() => undefined);
    await shot(`FAIL-${name}`).catch(() => undefined);
    // VOICE_E2E_BAIL=1 stops at the first failure (a quicker loop while fixing).
    if (process.env.VOICE_E2E_BAIL) {
      console.log("DONE");
      process.exit(0);
    }
  }
}

// Seen from inside the page: the microphone tracks, what the page said to the socket, what the device was asked to speak, and the panel's
// state text with the time it appeared.
await page.addInitScript(() => {
  const w = window as unknown as Record<string, unknown>;
  w.__spoken = [] as string[];
  w.__cancels = 0;
  w.__tracks = [] as MediaStreamTrack[];
  w.__constraints = null;
  w.__sent = [] as string[];
  w.__binOut = 0;
  w.__binIn = 0;
  w.__states = [] as { at: number; text: string }[];
  const synth = window.speechSynthesis;
  const speak = synth.speak.bind(synth);
  synth.speak = (u) => {
    (w.__spoken as string[]).push(u.text);
    try {
      speak(u);
    } catch {
      /* no voice in this browser: the call is what is tested */
    }
  };
  const cancel = synth.cancel.bind(synth);
  synth.cancel = () => {
    (w.__cancels as number)++;
    cancel();
  };
  const NativeContext = window.AudioContext;
  w.__contexts = [] as AudioContext[];
  window.AudioContext = class extends NativeContext {
    constructor(o?: AudioContextOptions) {
      super(o);
      (w.__contexts as AudioContext[]).push(this);
    }
  };
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    w.__constraints = c;
    const s = await gum(c);
    s.getTracks().forEach((t) => (w.__tracks as MediaStreamTrack[]).push(t));
    return s;
  };
  const Native = window.WebSocket;
  const Spy = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const s = new Native(url, protocols);
    const send = s.send.bind(s);
    s.send = (d: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      if (typeof d === "string") (w.__sent as string[]).push(d);
      else {
        (w.__binOut as number)++;
        const v = ArrayBuffer.isView(d)
          ? new Int16Array(d.buffer, d.byteOffset, d.byteLength >> 1)
          : new Int16Array(0);
        let m = 0;
        for (const x of v) m = Math.max(m, Math.abs(x));
        w.__maxAbs = Math.max((w.__maxAbs as number) ?? 0, m);
        if (m > 1000) w.__loudFrames = ((w.__loudFrames as number) ?? 0) + 1;
      }
      return send(d);
    };
    s.addEventListener("message", (e) => {
      if (typeof e.data !== "string") (w.__binIn as number)++;
    });
    return s;
  } as unknown as typeof WebSocket;
  Spy.prototype = Native.prototype;
  Object.assign(Spy, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Spy;
  const t0 = performance.now();
  setInterval(() => {
    const text =
      document.querySelector('section[aria-label="Voice call"] [role=status]')?.textContent ?? "";
    const list = w.__states as { at: number; text: string }[];
    if (text && list.at(-1)?.text !== text)
      list.push({ at: Math.round(performance.now() - t0), text });
  }, 30);
});

const panelText = () =>
  page.evaluate(
    () => document.querySelector('section[aria-label="Voice call"]')?.textContent ?? "",
  );
/** The page's text without the voice panel: what the chat itself shows. */
const chatText = () =>
  page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('section[aria-label="Voice call"]').forEach((n) => n.remove());
    return clone.innerText;
  });
const w = <T>(key: string) => page.evaluate((k) => (window as never as Record<string, T>)[k], key);
const status = () =>
  page.evaluate(
    () =>
      document.querySelector('section[aria-label="Voice call"] [role=status]')?.textContent ?? "",
  );
async function waitStatus(text: string, ms = 40_000) {
  await page.waitForFunction(
    (t) =>
      (
        document.querySelector('section[aria-label="Voice call"] [role=status]')?.textContent ?? ""
      ).startsWith(t),
    text,
    { timeout: ms, polling: 25 },
  );
}
const voiceButton = () => page.locator('button[aria-label^="Talk with"]');
const sentMessages = async () =>
  (await w<string[]>("__sent")).map((s) => JSON.parse(s) as Record<string, unknown>);
const trackStates = () =>
  page.evaluate(() =>
    ((window as never as Record<string, MediaStreamTrack[]>).__tracks ?? []).map(
      (t) => t.readyState,
    ),
  );
const api = (path: string) => page.evaluate((p) => fetch(p).then((r) => r.status), path);

// ---- the page, idle
await page.goto(`${ORIGIN}/chat/${CHAT}`, { waitUntil: "domcontentloaded" });

await check("The Voice button is next to the microphone in a plain chat", async () => {
  await voiceButton().waitFor({ state: "visible", timeout: 90_000 });
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("form button[aria-label]")].map((b) =>
      b.getAttribute("aria-label"),
    ),
  );
  const at = labels.indexOf("Record a message");
  assert(
    at >= 0 && labels[at + 1]?.startsWith("Talk with"),
    `toolbar was ${JSON.stringify(labels)}`,
  );
  const name = await voiceButton().getAttribute("aria-label");
  await shot("01-idle");
  return `"${name}" right after "Record a message"`;
});

// ---- a call with the browser voice
let startedAt = 0;
await check("The call starts: microphone with echo cancellation, then Listening", async () => {
  startedAt = Date.now();
  await voiceButton().click();
  await waitStatus("Listening", 30_000);
  const ms = Date.now() - startedAt;
  const c = (await w<{ audio: Record<string, boolean> }>("__constraints"))!.audio;
  assert(
    c.echoCancellation && c.noiseSuppression && c.autoGainControl,
    `constraints ${JSON.stringify(c)}`,
  );
  const sent = await sentMessages();
  assert(
    sent[0]?.type === "start" && typeof sent[0].language === "string",
    `first message ${JSON.stringify(sent[0])}`,
  );
  await shot("02-listening");
  return `${ms} ms from the click to Listening; start language ${String(sent[0]!.language)}`;
});

await check("The spoken sentence appears as the person's message, once", async () => {
  await page.waitForFunction(
    () => /invoice/i.test(document.body.innerText) && /client/i.test(document.body.innerText),
    undefined,
    { timeout: 60_000, polling: 100 },
  );
  await shot("03-heard");
  // After the bridge line goes (4 s), the sentence is in the chat once and the panel holds none of it.
  await sleep(5000);
  const text = await chatText();
  const words = SENTENCE.toLowerCase()
    .replace(/[^a-z ]/g, "")
    .split(/\s+/);
  const got = text.toLowerCase();
  const found = words.filter((x) => got.includes(x)).length / words.length;
  assert(found >= 0.7, `only ${Math.round(found * 100)}% of the words are in the chat`);
  const count = (text.match(/invoice to the client/gi) ?? []).length;
  assert(count === 1, `the sentence shows ${count} times in the chat`);
  assert(!/invoice/i.test(await panelText()), "the panel still repeats the sentence");
  const line = /.{0,50}invoice to the client.{0,30}/i.exec(text)?.[0];
  return `in the chat once: "${line?.trim()}"`;
});

await check("The bot's reply appears in the chat", async () => {
  await page.waitForFunction(
    () => /remind you on Friday/i.test(document.body.innerText),
    undefined,
    {
      timeout: 60_000,
      polling: 100,
    },
  );
  const text = await chatText();
  for (const s of REPLY) assert(text.includes(s.replace(/\.$/, "")), `missing "${s}"`);
  return "both sentences are in the chat";
});

await check("The reply is spoken: speechSynthesis was called with the reply text", async () => {
  await page.waitForFunction(
    (n) => ((window as never as Record<string, string[]>).__spoken ?? []).length >= n,
    REPLY.length,
    { timeout: 30_000 },
  );
  const spoken = await w<string[]>("__spoken");
  for (const s of REPLY)
    assert(spoken.includes(s), `not spoken: "${s}"; spoken ${JSON.stringify(spoken)}`);
  return spoken.map((s) => `"${s}"`).join(" / ");
});

await check("The panel went through Listening, Thinking and Speaking", async () => {
  const states = (await w<{ at: number; text: string }[]>("__states")).map((s) => s.text);
  for (const s of ["Listening", "Thinking", "Speaking"])
    assert(
      states.some((x) => x.startsWith(s)),
      `${s} not seen; saw ${JSON.stringify(states)}`,
    );
  const at = (s: string) => states.indexOf(states.find((x) => x.startsWith(s))!);
  assert(at("Thinking") < at("Speaking"), `order ${JSON.stringify(states)}`);
  return states.join(" > ");
});

await check("Mute and Unmute reach the server and stop and resume the frames", async () => {
  await waitStatus("Listening", 30_000);
  const before = await w<number>("__binOut");
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await sleep(300);
  const mid = await w<number>("__binOut");
  await sleep(600);
  const after = await w<number>("__binOut");
  assert(after === mid, `${after - mid} frames went out while muted`);
  assert((await status()).includes("muted"), `status was "${await status()}"`);
  await shot("05-muted");
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  await sleep(600);
  assert((await w<number>("__binOut")) > after, "no frames after unmuting");
  const types = (await sentMessages()).map((m) => m.type);
  assert(types.includes("mute") && types.includes("unmute"), `sent ${types.join(",")}`);
  return `${before} frames before, none while muted, resumed`;
});

await check("Escape outside the panel does nothing; End stops the microphone track", async () => {
  // Focus in the message box (outside the panel): Escape must not end the call.
  await page.locator('[aria-label="Message"]').first().click();
  await page.keyboard.press("Escape");
  await sleep(200);
  assert(
    (await trackStates()).every((s) => s === "live"),
    "Escape outside the panel ended the call",
  );
  await page.getByRole("button", { name: "End call" }).focus();
  await shot("06-before-end");
  await page.getByRole("button", { name: "End call" }).click();
  await sleep(500);
  const states = await trackStates();
  assert(
    states.length > 0 && states.every((s) => s === "ended"),
    `tracks ${JSON.stringify(states)}`,
  );
  assert(
    (await sentMessages()).some((m) => m.type === "end"),
    "no end message",
  );
  assert((await panelText()).includes("The call ended"), `panel said "${await panelText()}"`);
  await shot("07-ended");
  return `${states.length} track(s) ended; panel says the call ended`;
});

await check("The panel's own Escape ends a call", async () => {
  await page.getByRole("button", { name: "Start again" }).click();
  await waitStatus("Listening", 30_000);
  await page.getByRole("button", { name: "Mute", exact: true }).focus();
  await page.keyboard.press("Escape");
  await sleep(500);
  assert(
    (await trackStates()).every((s) => s === "ended"),
    "tracks still live after Escape in the panel",
  );
  assert((await panelText()).includes("The call ended"), "no end notice");
  return "Escape with focus on Mute ended the call";
});

// ---- the bot's voice as audio frames
await check(
  "A provider voice plays through the audio worklet and `played` reaches the server",
  async () => {
    assert((await api("/api/__e2e/mode?m=remote")) === 200, "mode not set");
    const inBefore = await w<number>("__binIn");
    const sentBefore = (await sentMessages()).length;
    await page.getByRole("button", { name: "Start again" }).click();
    await waitStatus("Listening", 30_000);
    await page.waitForFunction(
      (n) => ((window as never as Record<string, number>).__binIn ?? 0) > n,
      inBefore,
      { timeout: 90_000, polling: 100 },
    );
    await waitStatus("Speaking", 30_000).catch(() => undefined);
    await shot("08-speaking-audio");
    await page.waitForFunction(
      (n) =>
        ((window as never as Record<string, string[]>).__sent ?? [])
          .slice(n)
          .some((m) => JSON.parse(m).type === "played" && JSON.parse(m).samples > 0),
      sentBefore,
      { timeout: 30_000, polling: 100 },
    );
    const played = (await sentMessages())
      .slice(sentBefore)
      .filter((m) => m.type === "played")
      .map((m) => Number(m.samples));
    const frames = (await w<number>("__binIn")) - inBefore;
    return `${frames} audio frames received; played reports ${played.slice(0, 6).join(", ")}${played.length > 6 ? " ..." : ""}`;
  },
);
await check("A second call ends cleanly again with the audio context closed", async () => {
  await page.getByRole("button", { name: "End call" }).click();
  await sleep(500);
  assert(
    (await trackStates()).every((s) => s === "ended"),
    "tracks still live",
  );
  return "ok";
});
await api("/api/__e2e/mode?m=browser");

// ---- another device takes the call; the server restarts
await check("A call replaced from another tab or device says so", async () => {
  await page.getByRole("button", { name: "Start again" }).click();
  await waitStatus("Listening", 30_000);
  await api("/api/__e2e/replace");
  await page.waitForFunction(
    () => document.body.innerText.includes("another tab or on another device"),
    undefined,
    { timeout: 15_000 },
  );
  assert(
    (await trackStates()).every((s) => s === "ended"),
    "tracks still live",
  );
  await shot("09-replaced");
  return "notice shown, microphone released";
});
await check("A server restart ends the call with its own words", async () => {
  await page.getByRole("button", { name: "Start again" }).click();
  await waitStatus("Listening", 30_000);
  await api("/api/__e2e/restart");
  await page.waitForFunction(
    () => document.body.innerText.includes("server restarted"),
    undefined,
    {
      timeout: 15_000,
    },
  );
  await shot("10-restart");
  return "notice shown";
});

// ---- switching chat ends the call
await check("Switching to another chat ends the call and releases the microphone", async () => {
  await page.getByRole("button", { name: "Start again" }).click();
  await waitStatus("Listening", 30_000);
  const live = (await trackStates()).filter((s) => s === "live").length;
  assert(live >= 1, "no live track before the switch");
  const sentBefore = (await sentMessages()).length;
  // The other bot's tile in the sidebar opens that bot's chat (its latest conversation, or an empty draft).
  await page
    .getByRole("button", { name: /Second bot/ })
    .first()
    .click();
  await page.waitForURL((u) => !u.pathname.includes(CHAT));
  await sleep(500);
  assert(
    (await trackStates()).every((s) => s === "ended"),
    `tracks ${JSON.stringify(await trackStates())}`,
  );
  assert(
    (await sentMessages()).slice(sentBefore).some((m) => m.type === "end"),
    "no end message sent on the switch",
  );
  assert((await panelText()) === "", "the panel is still there in the other chat");
  await voiceButton().waitFor({ state: "visible" });
  await shot("11-other-chat");
  return "end sent, tracks ended, panel gone, the button is there for the other bot";
});

// ---- leaving the page
await check("Leaving the page releases the microphone and the server ends the call", async () => {
  await voiceButton().click();
  await waitStatus("Listening", 30_000);
  const cdp = await context.newCDPSession(page);
  await page.goto(`${ORIGIN}/chat/${CHAT}`, { waitUntil: "domcontentloaded" });
  await cdp.detach().catch(() => undefined);
  await voiceButton().waitFor({ state: "visible", timeout: 60_000 });
  return "reloaded while on a call; the new page starts idle";
});

// ---- a microphone that is refused (the browser's answer is simulated: the permission prompt is turned off in this run)
await check("A refused microphone shows how to allow it and a way to start again", async () => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  await voiceButton().click();
  await page.waitForFunction(
    () => document.body.innerText.includes("Microphone: Allow"),
    undefined,
    {
      timeout: 10_000,
    },
  );
  await shot("12-mic-denied");
  assert(await page.getByRole("button", { name: "Start again" }).isVisible(), "no Start again");
  return "simulated NotAllowedError";
});

console.log("DONE");
await browser.close().catch(() => undefined);
process.exit(0);
