import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { bytesToBase64, clock, floatToPcm16, withTranscript } from "./audio";

const win = setupDom();
const { MicButton } = await import("./microphone");

afterEach(() => {
  win.document.body.innerHTML = "";
});

test("samples become 16-bit little-endian bytes, clipped and never wrapped", () => {
  const bytes = floatToPcm16(new Float32Array([0, 0.5, -0.5, 1, -1, 5, -5]));
  const v = new DataView(bytes.buffer);
  expect([0, 1, 2, 3, 4, 5, 6].map((i) => v.getInt16(i * 2, true))).toEqual([
    0, 16384, -16384, 32767, -32768, 32767, -32768,
  ]);
});

test("base64 of a long recording does not overflow the stack and round-trips", () => {
  const bytes = new Uint8Array(1_000_000).map((_, i) => i % 251);
  const back = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
  expect(back.length).toBe(bytes.length);
  expect(back[999_999]).toBe(bytes[999_999]!);
  expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
});

test("the clock and the transcript join read as a person would write them", () => {
  expect(clock(7)).toBe("0:07");
  expect(clock(125)).toBe("2:05");
  expect(withTranscript("", "hello")).toBe("hello");
  expect(withTranscript("Dear Ana,", "see you")).toBe("Dear Ana, see you");
  expect(withTranscript("Dear Ana, ", "see you")).toBe("Dear Ana, see you");
  expect(withTranscript("kept", "")).toBe("kept");
});

// ---- the button -----------------------------------------------------------------------------------------------------------------------
let stopped = 0;
let denied = false;
class FakeRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}
beforeEach(() => {
  stopped = 0;
  denied = false;
  Object.assign(globalThis, { MediaRecorder: FakeRecorder });
  Object.defineProperty(win.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        if (denied) throw new Error("NotAllowedError");
        return { getTracks: () => [{ stop: () => void stopped++ }] };
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: win.navigator });
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
const button = () => win.document.querySelector("button")!;
const click = async () => {
  await act(
    async () => void button().dispatchEvent(new win.MouseEvent("click", { bubbles: true })),
  );
  await settle();
};
async function mount(props: Partial<Parameters<typeof MicButton>[0]> = {}) {
  const heard: string[] = [];
  const errors: string[] = [];
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <MicButton
        onText={(t) => heard.push(t)}
        onError={(e) => errors.push((e as Error).message)}
        toSamples={async () => new Float32Array(16000)}
        send={async (s) => `heard ${s.length} samples`}
        {...props}
      />,
    ),
  );
  return { heard, errors, unmount: () => act(async () => root.unmount()) };
}

test("press to record, press again to stop: the words go to the message and the microphone is let go", async () => {
  const { heard, errors, unmount } = await mount();
  expect(button().getAttribute("aria-label")).toBe("Record a message");
  await click();
  expect(button().getAttribute("aria-pressed")).toBe("true");
  expect(button().getAttribute("aria-label")).toContain("Stop recording");
  await click();
  expect(heard).toEqual(["heard 16000 samples"]);
  expect(errors).toEqual([]);
  expect(stopped).toBe(1);
  expect(button().getAttribute("aria-label")).toBe("Record a message");
  await unmount();
});

test("a refused microphone and a browser that cannot record each say so in words", async () => {
  denied = true;
  const a = await mount();
  await click();
  expect(a.errors[0]).toContain("permission to use the microphone");
  expect(button().getAttribute("aria-pressed")).toBe("false");
  await a.unmount();
  delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  const b = await mount();
  await click();
  expect(b.errors[0]).toContain("cannot record");
  await b.unmount();
});

test("a recording where nothing was heard, or that the server could not read, is reported and the button works again", async () => {
  const silent = await mount({ send: async () => "" });
  await click();
  await click();
  expect(silent.heard).toEqual([]);
  expect(silent.errors[0]).toContain("Nothing could be heard");
  await silent.unmount();
  const broken = await mount({ send: async () => Promise.reject(new Error("The server is busy")) });
  await click();
  await click();
  expect(broken.errors[0]).toBe("The server is busy");
  expect(button().disabled).toBe(false);
  await broken.unmount();
});

test("closing the box while recording drops the recording and lets the microphone go", async () => {
  const { heard, unmount } = await mount();
  await click();
  await unmount();
  expect(stopped).toBe(1);
  expect(heard).toEqual([]);
});
