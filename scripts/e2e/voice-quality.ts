// Voice quality on this machine, measured: the local voice (Kokoro, the `local` text-to-speech provider) against macOS `say`, each read
// back by local Whisper models of growing size. Writes .e2e-reports/voice-quality.md. Nothing leaves the machine except the model
// downloads (about 100 MB for the voice, 0.4 to 1.2 GB per larger Whisper model); a model already in the folder is not downloaded again.
// Gated: `bun test` never runs this file. It starts no server; each Whisper model runs in a child process (so its memory is freed
// before the next) that is stopped, by process group, on SIGTERM/SIGINT.
//   bun scripts/e2e/voice-quality.ts [--models=Xenova/whisper-small,Xenova/whisper-medium,onnx-community/whisper-large-v3-turbo]
import { spawn } from "bun";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalSynthesizer } from "../../apps/server/src/modules/speech/local";
import { createLocalTranscriber } from "../../apps/server/src/modules/transcribe/transcriber";
import { clean, REPO } from "./report";

type Lang = "pt" | "es" | "en";
const LANGS: Lang[] = ["pt", "es", "en"];
const TAG: Record<Lang, string> = { pt: "pt-BR", es: "es-ES", en: "en-US" };
const SAY_VOICE: Record<Lang, string> = { pt: "Luciana", es: "Mónica", en: "Samantha" };
const DEFAULT_MODELS = [
  "Xenova/whisper-small",
  "Xenova/whisper-medium",
  "onnx-community/whisper-large-v3-turbo",
];

// Everyday things a person says to an assistant: dates, names, numbers.
const SENTENCES: Record<Lang, string[]> = {
  pt: [
    "Me lembre de ligar para a Marina na quarta-feira às 15 horas.",
    "A reunião com o João foi marcada para o dia 12 de março.",
    "Quanto custa a passagem de São Paulo para Recife em julho?",
    "Adicione leite, pão e 6 ovos na lista de compras.",
    "O aniversário da Fernanda é no dia 28 de setembro.",
    "Envie a fatura de 350 reais para o cliente até sexta-feira.",
    "Qual é a previsão do tempo para amanhã em Curitiba?",
    "Agende uma consulta com a doutora Beatriz na próxima segunda.",
    "Preciso de 20 minutos para terminar o relatório do Carlos.",
    "Cancele a reserva do restaurante e avise o Pedro.",
  ],
  es: [
    "Recuérdame llamar a Marina el miércoles a las 3 de la tarde.",
    "La reunión con Juan es el 12 de marzo.",
    "¿Cuánto cuesta el billete de Madrid a Sevilla en julio?",
    "Añade leche, pan y 6 huevos a la lista de la compra.",
    "El cumpleaños de Fernanda es el 28 de septiembre.",
    "Envía la factura de 350 euros al cliente antes del viernes.",
    "¿Qué tiempo hará mañana en Valencia?",
    "Pide una cita con la doctora Beatriz para el próximo lunes.",
    "Necesito 20 minutos para terminar el informe de Carlos.",
    "Cancela la reserva del restaurante y avisa a Pedro.",
  ],
  en: [
    "Remind me to call Marina on Wednesday at 3 in the afternoon.",
    "The meeting with John is on March 12.",
    "How much is a ticket from Boston to Chicago in July?",
    "Add milk, bread and 6 eggs to the shopping list.",
    "Fernanda's birthday is on September 28.",
    "Send the invoice for 350 dollars to the client by Friday.",
    "What is the weather forecast for tomorrow in Seattle?",
    "Book an appointment with Doctor Beatriz for next Monday.",
    "I need 20 minutes to finish Carl's report.",
    "Cancel the restaurant reservation and tell Peter.",
  ],
};
// For the time to first audio and the real-time factor: one short and one long text per language.
const SHORT: Record<Lang, string> = {
  pt: "Claro, já faço isso agora.",
  es: "Claro, lo hago ahora mismo.",
  en: "Sure, I will do that right now.",
};
const LONG: Record<Lang, string> = {
  pt: "Encontrei três horários livres na sua agenda de quinta-feira: às nove da manhã, às duas da tarde e às quatro e meia. Posso marcar a reunião com a equipe em um deles e avisar todo mundo por mensagem, se você quiser.",
  es: "He encontrado tres horarios libres en tu agenda del jueves: a las nueve de la mañana, a las dos de la tarde y a las cuatro y media. Puedo reservar la reunión con el equipo en uno de ellos y avisar a todos por mensaje, si quieres.",
  en: "I found three free slots in your calendar on Thursday: at nine in the morning, at two in the afternoon and at half past four. I can book the team meeting in one of them and let everyone know by message, if you like.",
};

const SAMPLE_RATE = 16_000;
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// ---- scoring -----------------------------------------------------------------------------------------------------------------------
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[$€£%]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
/** 1 - (substitutions + deletions + insertions) / reference words, never below 0. Accents and punctuation are not counted. */
export function wordAccuracy(reference: string, heard: string): number {
  const a = words(reference);
  const b = words(heard);
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return Math.max(0, 1 - d[a.length]![b.length]! / Math.max(1, a.length));
}

// ---- Whisper stage (child process) ---------------------------------------------------------------------------------------------------
async function sttStage(model: string, dir: string) {
  const clips = JSON.parse(readFileSync(join(dir, "clips.json"), "utf8")) as {
    id: string;
    voice: string;
    lang: Lang;
    text: string;
  }[];
  const cacheRoot =
    process.env.ZETTA_TRANSCRIBE_MODEL_DIR ?? join(homedir(), ".cache", "zetta", "models");
  const cached = existsSync(join(cacheRoot, model));
  const t = createLocalTranscriber({ model });
  const read = (id: string) => {
    const b = readFileSync(join(dir, `${id}.f32`));
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
  };
  const t0 = Date.now();
  const first = clips[0]!;
  await t.transcribe(read(first.id), { language: TAG[first.lang] });
  const loadMs = Date.now() - t0;
  const rows: { id: string; heard: string; ms: number; seconds: number }[] = [];
  for (const c of clips) {
    const pcm = read(c.id);
    const s = Date.now();
    const heard = await t.transcribe(pcm, { language: TAG[c.lang] });
    rows.push({ id: c.id, heard, ms: Date.now() - s, seconds: pcm.length / SAMPLE_RATE });
    console.log(`${model} ${c.id}: ${heard}`);
  }
  const size = (p: string): number =>
    !existsSync(p)
      ? 0
      : statSync(p).isDirectory()
        ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0)
        : statSync(p).size;
  writeFileSync(
    join(dir, `stt-${model.replaceAll("/", "__")}.json`),
    JSON.stringify({ model, cached, loadMs, bytes: size(join(cacheRoot, model)), rows }),
  );
}

// ---- voice stage (parent) --------------------------------------------------------------------------------------------------------------
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const toFloat = (p: Int16Array) => Float32Array.from(p, (v) => v / 32768);
const save = (dir: string, id: string, pcm: Float32Array) =>
  writeFileSync(join(dir, `${id}.f32`), new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));

async function sayClip(
  voice: string,
  text: string,
  dir: string,
  id: string,
): Promise<Float32Array> {
  const aiff = join(dir, `${id}.aiff`);
  const wav = join(dir, `${id}.wav`);
  await Bun.$`say -v ${voice} -o ${aiff} ${text}`.quiet();
  await Bun.$`afconvert -f WAVE -d LEI16@16000 -c 1 ${aiff} ${wav}`.quiet();
  const b = readFileSync(wav);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 12;
  while (at + 8 <= b.length) {
    const tag = b.toString("ascii", at, at + 4);
    const size = v.getUint32(at + 4, true);
    if (tag === "data") {
      const n = Math.floor(Math.min(size, b.length - at - 8) / 2);
      return Float32Array.from({ length: n }, (_, i) => v.getInt16(at + 8 + i * 2, true) / 32768);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no audio in the clip");
}

async function main() {
  const stage = arg("stage");
  if (stage === "stt") return sttStage(arg("model")!, arg("dir")!);
  if (!Bun.which("say") || !Bun.which("afconvert")) {
    console.log("SKIP: `say` and `afconvert` (macOS) are needed to make the comparison clips.");
    return;
  }
  const models = (arg("models") ?? DEFAULT_MODELS.join(",")).split(",").filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), "zetta-voice-quality-"));
  let child: ReturnType<typeof spawn> | undefined;
  const stop = () => {
    try {
      if (child?.pid) process.kill(-child.pid, "SIGTERM");
    } catch {}
    rmSync(dir, { recursive: true, force: true });
    process.exit(130);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const synth = createLocalSynthesizer();
    // 1. Speed of the local voice (model load is reported on its own).
    const speed: Record<string, { first: number; total: number; seconds: number }> = {};
    const tLoad = Date.now();
    await synth.synthesize("Olá.", { language: "pt-BR" });
    const coldMs = Date.now() - tLoad;
    for (const lang of LANGS) await synth.synthesize(SHORT[lang], { language: TAG[lang] }); // warm: phonemizer, voice files
    for (const lang of LANGS)
      for (const [kind, text] of [
        ["short", SHORT[lang]],
        ["long", LONG[lang]],
      ] as const) {
        const firsts: number[] = [];
        const totals: number[] = [];
        let seconds = 0;
        for (let run = 0; run < 3; run++) {
          const t0 = Date.now();
          let first = 0;
          let samples = 0;
          for await (const c of synth.stream(text, { language: TAG[lang] })) {
            if (!first) first = Date.now() - t0;
            samples += c.length;
          }
          firsts.push(first);
          totals.push(Date.now() - t0);
          seconds = samples / SAMPLE_RATE;
        }
        speed[`${lang}-${kind}`] = { first: median(firsts), total: median(totals), seconds };
        console.log(`speed ${lang} ${kind}`, speed[`${lang}-${kind}`]);
      }
    // 2. The clips: the local voice and macOS `say`.
    const clips: { id: string; voice: string; lang: Lang; text: string }[] = [];
    for (const lang of LANGS)
      for (const [i, text] of SENTENCES[lang].entries()) {
        const local = `local-${lang}-${i}`;
        save(dir, local, toFloat(await synth.synthesize(text, { language: TAG[lang] })));
        clips.push({ id: local, voice: "local", lang, text });
        const say = `say-${lang}-${i}`;
        save(dir, say, await sayClip(SAY_VOICE[lang], text, dir, say));
        clips.push({ id: say, voice: "say", lang, text });
      }
    writeFileSync(join(dir, "clips.json"), JSON.stringify(clips));
    // 3. Each Whisper model, one child process at a time.
    const results: Record<string, any> = {};
    for (const model of models) {
      const t0 = Date.now();
      child = spawn(
        [
          "nice",
          "-n",
          "10",
          "timeout",
          "3000",
          "bun",
          join(REPO, "scripts/e2e/voice-quality.ts"),
          "--stage=stt",
          `--model=${model}`,
          `--dir=${dir}`,
        ],
        { stdout: "inherit", stderr: "inherit", detached: true },
      );
      const code = await child.exited;
      child = undefined;
      const file = join(dir, `stt-${model.replaceAll("/", "__")}.json`);
      if (code !== 0 || !existsSync(file)) {
        console.log(
          `model ${model} failed (exit ${code}) after ${Math.round((Date.now() - t0) / 1000)} s`,
        );
        results[model] = { failed: code };
        continue;
      }
      results[model] = JSON.parse(readFileSync(file, "utf8"));
    }
    writeFileSync(join(dir, "results.json"), JSON.stringify({ speed, coldMs, results }));
    // 4. The report.
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const f1 = (n: number) => n.toFixed(2);
    const lines: string[] = [
      "# Voice quality on this machine",
      "",
      `Run: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Script: \`scripts/e2e/voice-quality.ts\`. Machine: ${process.platform} ${process.arch}, ${navigator.hardwareConcurrency} cores, Bun ${Bun.version}.`,
      "",
      "Local voice = Kokoro-82M v1.0 (`q8`), the `local` text-to-speech provider. Comparison voice = macOS `say` (Luciana pt-BR, Mónica es-ES, Samantha en-US). Each of 10 sentences per language (dates, names, numbers) was spoken, brought to 16 kHz mono and read back by local Whisper (`q8`) told the language. Accuracy is 1 minus the word error rate; case, accents and punctuation are not counted; digits are compared as written (a model that writes a number in words is charged for it). Both voices are synthetic and clean: a real person, a noisy room or an accent is harder, so read the numbers as a ranking of models, not as the rate a person will see.",
      "",
      "## Speed of the local voice",
      "",
      `First use (download already done): ${(coldMs / 1000).toFixed(1)} s to load the model and speak one word. Then, median of 3 runs, one text at a time, 10-core machine, nothing else heavy running.`,
      "",
      "| Language | Text | Audio | First audio | Total | Real-time factor |",
      "| --- | --- | --- | --- | --- | --- |",
      ...LANGS.flatMap((lang) =>
        (["short", "long"] as const).map((kind) => {
          const s = speed[`${lang}-${kind}`]!;
          return `| ${TAG[lang]} | ${kind} (${(kind === "short" ? SHORT[lang] : LONG[lang]).length} chars) | ${s.seconds.toFixed(1)} s | ${(s.first / 1000).toFixed(2)} s | ${(s.total / 1000).toFixed(2)} s | ${f1(s.total / 1000 / s.seconds)} |`;
        }),
      ),
      "",
      "Real-time factor = time to make the audio / length of the audio; below 1 is faster than speech. First audio is the time to the first sentence, not the first sample.",
      "",
      "## Word accuracy, round trip",
      "",
    ];
    const ok = models.filter((m) => !results[m].failed);
    lines.push(
      `| Voice | Language | ${ok.map((m) => m.split("/")[1]).join(" | ")} |`,
      `| --- | --- | ${ok.map(() => "---").join(" | ")} |`,
    );
    const heard = (m: string, id: string) =>
      results[m].rows.find((r: any) => r.id === id).heard as string;
    const acc = (m: string, voice: string, lang: Lang) =>
      SENTENCES[lang].reduce(
        (n, t, i) => n + wordAccuracy(t, heard(m, `${voice}-${lang}-${i}`)),
        0,
      ) / SENTENCES[lang].length;
    for (const voice of ["local", "say"])
      for (const lang of LANGS)
        lines.push(
          `| ${voice === "local" ? "local (Kokoro)" : "say"} | ${TAG[lang]} | ${ok.map((m) => pct(acc(m, voice, lang))).join(" | ")} |`,
        );
    lines.push(
      "",
      "## Whisper models",
      "",
      "| Model | Download (on disk) | Load + first clip | Transcription of 60 clips | Per clip |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const m of ok) {
      const r = results[m];
      const total = r.rows.reduce((n: number, x: any) => n + x.ms, 0);
      lines.push(
        `| ${m} | ${(r.bytes / 1e6).toFixed(0)} MB | ${(r.loadMs / 1000).toFixed(0)} s${r.cached ? "" : " (download included)"} | ${(total / 1000).toFixed(0)} s | ${(total / r.rows.length / 1000).toFixed(1)} s |`,
      );
    }
    for (const m of models.filter((x) => results[x].failed))
      lines.push(`| ${m} | failed (exit ${results[m].failed}) | | | |`);
    lines.push("", "## What each model heard (local voice, Portuguese)", "");
    for (const m of ok)
      for (const [i, t] of SENTENCES.pt.entries())
        lines.push(`- ${m.split("/")[1]} #${i + 1}: "${t}" -> "${heard(m, `local-pt-${i}`)}"`);
    lines.push("");
    const out = join(REPO, ".e2e-reports/voice-quality.md");
    mkdirSync(join(REPO, ".e2e-reports"), { recursive: true });
    writeFileSync(out, clean(lines.join("\n")));
    console.log("written .e2e-reports/voice-quality.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
await main();
