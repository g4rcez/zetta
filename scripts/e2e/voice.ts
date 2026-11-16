// Voice with the real speech model: a clip is spoken by the machine's own voice, turned into 16 kHz mono samples the way the browser
// does it, and read back by the real Whisper model through the server's transcriber. The first run downloads the model (about 150 MB).
// Needs macOS (`say`, `afconvert`) to make the clip. Nothing leaves the machine.
//   bun scripts/e2e/voice.ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalTranscriber,
  SAMPLE_RATE,
} from "../../apps/server/src/modules/transcribe/transcriber";
import { createReport } from "./report";

const report = createReport("voice", "Voice: a spoken clip read back by the real Whisper model");
if (!Bun.which("say") || !Bun.which("afconvert")) {
  report.skip(
    "Speech clip",
    "`say` and `afconvert` (macOS) are needed to make a clip; run this on a Mac",
  );
  process.exit(report.finish("macOS, network for the first model download"));
}
const dir = mkdtempSync(join(tmpdir(), "zetta-voice-"));
const SENTENCE = "Please remind me to send the invoice to the client on Friday morning.";
try {
  const aiff = join(dir, "clip.aiff");
  const wav = join(dir, "clip.wav");
  await Bun.$`say -o ${aiff} ${SENTENCE}`.quiet();
  await Bun.$`afconvert -f WAVE -d LEI16@16000 -c 1 ${aiff} ${wav}`.quiet();
  // The WAV header of afconvert may hold extra chunks: find the "data" chunk instead of assuming 44 bytes.
  const bytes = readFileSync(wav);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let start = -1;
  let length = 0;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = view.getUint32(at + 4, true);
    if (id === "data") {
      start = at + 8;
      length = Math.min(size, bytes.length - start);
      break;
    }
    at += 8 + size + (size % 2);
  }
  const pcm = new Float32Array(Math.floor(length / 2));
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(start + i * 2, true) / 32768;
  const seconds = pcm.length / SAMPLE_RATE;
  const heard = { text: "" };
  await report.check("The clip is 16 kHz mono samples", async () => {
    if (start < 0 || pcm.length < SAMPLE_RATE) throw new Error("no audio in the clip");
    return `${seconds.toFixed(1)} s`;
  });
  await report.check("Whisper reads the clip back", async () => {
    const t0 = Date.now();
    heard.text = await createLocalTranscriber().transcribe(pcm);
    const words = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z ]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    const want = new Set(words(SENTENCE));
    const got = words(heard.text);
    const hit = new Set(got.filter((w) => want.has(w))).size;
    const ratio = hit / want.size;
    if (ratio < 0.7)
      throw new Error(
        `only ${Math.round(ratio * 100)}% of the words came back: "${heard.text.trim()}"`,
      );
    return `${Math.round(ratio * 100)}% of the words, ${((Date.now() - t0) / 1000).toFixed(1)} s (including model load): "${heard.text.trim()}"`;
  });
  // Portuguese: Whisper must be told the language (it assumes English), as the browser's language tells the server.
  await report.check("Whisper reads Portuguese when told the language", async () => {
    if (!Bun.spawnSync(["say", "-v", "?"]).stdout.toString().includes("Flo"))
      throw new Error("no Brazilian Portuguese voice on this Mac");
    const voice = "Flo";
    const PT = "Por favor, me lembre de enviar a fatura para o cliente na sexta-feira de manhã.";
    const a = join(dir, "pt.aiff");
    const w = join(dir, "pt.wav");
    await Bun.$`say -v ${voice} -o ${a} ${PT}`.quiet();
    await Bun.$`afconvert -f WAVE -d LEI16@16000 -c 1 ${a} ${w}`.quiet();
    const b = readFileSync(w);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 12;
    let s0 = -1;
    let n = 0;
    while (p + 8 <= b.length) {
      const id = b.toString("ascii", p, p + 4);
      const size = v.getUint32(p + 4, true);
      if (id === "data") {
        s0 = p + 8;
        n = Math.min(size, b.length - s0);
        break;
      }
      p += 8 + size + (size % 2);
    }
    const samples = new Float32Array(Math.floor(n / 2));
    for (let i = 0; i < samples.length; i++) samples[i] = v.getInt16(s0 + i * 2, true) / 32768;
    const t = createLocalTranscriber();
    const text = await t.transcribe(samples, { language: "pt-BR" });
    const norm = (x: string) =>
      x
        .toLowerCase()
        .normalize("NFD")
        .replace(/[^a-z ]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    const want = new Set(norm(PT));
    const ratio = new Set(norm(text).filter((x) => want.has(x))).size / want.size;
    if (text.length > 400) throw new Error(`it looped: ${text.slice(0, 120)}…`);
    if (ratio < 0.4)
      throw new Error(`only ${Math.round(ratio * 100)}% of the words: "${text.trim()}"`);
    return `${Math.round(ratio * 100)}% of the words with a synthetic Brazilian voice (approximate: the small model is not exact in Portuguese): "${text.trim()}"`;
  });
  // A real provider, only when a key is given: ZETTA_E2E_TRANSCRIBE_KEY (and optionally ZETTA_E2E_TRANSCRIBE_URL and _MODEL for an
  // OpenAI-compatible server). The English clip goes to that provider, which is a third party: nothing runs without the key.
  const realKey = process.env.ZETTA_E2E_TRANSCRIBE_KEY;
  if (!realKey)
    report.skip(
      "A real provider reads the clip",
      "no ZETTA_E2E_TRANSCRIBE_KEY set: the provider path was tested against a local fake only",
    );
  else
    await report.check("A real provider reads the clip", async () => {
      const t0 = Date.now();
      const baseUrl = process.env.ZETTA_E2E_TRANSCRIBE_URL ?? OPENAI_BASE_URL;
      const remote = createRemoteTranscriber({
        allowPrivate: Boolean(process.env.ZETTA_E2E_TRANSCRIBE_URL),
        resolve: async () => ({
          provider: "compatible",
          baseUrl,
          model: process.env.ZETTA_E2E_TRANSCRIBE_MODEL ?? "whisper-1",
          key: Buffer.from(realKey),
        }),
      });
      const text = await remote.transcribe(pcm, { language: "en" });
      const words = (x: string) =>
        x
          .toLowerCase()
          .replace(/[^a-z ]/g, " ")
          .split(/\s+/)
          .filter(Boolean);
      const want = new Set(words(SENTENCE));
      const ratio = new Set(words(text).filter((w) => want.has(w))).size / want.size;
      if (ratio < 0.7)
        throw new Error(
          `only ${Math.round(ratio * 100)}% of the words came back: "${text.trim()}"`,
        );
      return `${Math.round(ratio * 100)}% of the words from ${new URL(baseUrl).host} in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
    });
  report.note(
    "Portuguese came back about half right on synthetic voices with the small model: usable to get the idea of a voice note, not a transcript to rely on. A larger model can be set with ZETTA_TRANSCRIBE_MODEL (not tried here).",
  );
  report.note(
    "The clip is synthetic speech from the machine's own voice, so accents, noise and a real microphone are not covered.",
  );
  report.note(
    "The browser microphone path (recording and resampling) is checked in a real browser with a fake input device, not here.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(report.finish("macOS, network for the first model download"));
