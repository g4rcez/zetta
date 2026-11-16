import { strFromU8, unzipSync } from "fflate";
import { getDocumentProxy } from "unpdf";

/** The documents a person can attach whose text a bot can read: the extension (or the type the browser gave) decides, the bytes are checked. */
export const DOCUMENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_TYPES;
export const DOCUMENT_MIMES = Object.values(DOCUMENT_TYPES) as [string, ...string[]];

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
/** What goes to the bot: the text of the document, cut here. */
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_PDF_PAGES = 200;
const MAX_ZIP_ENTRIES = 400;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_COLS = 100;
const DEADLINE_MS = 30_000;

export class DocumentError extends Error {
  constructor(
    readonly code: "UNSUPPORTED" | "TOO_BIG" | "EMPTY" | "UNREADABLE",
    /** A sentence for the person. */
    readonly safe: string,
  ) {
    super(code);
  }
}

/** Which document this is, by its name and the type the browser reported. Undefined for anything that is not one of the six. */
export function documentKind(name: string, mime = ""): DocumentKind | undefined {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && ext in DOCUMENT_TYPES) return ext as DocumentKind;
  return (
    (Object.entries(DOCUMENT_TYPES).find(([, m]) => m === mime)?.[0] as DocumentKind | undefined) ??
    undefined
  );
}

const isPdf = (b: Uint8Array) => b.length > 5 && strFromU8(b.subarray(0, 5)) === "%PDF-";
const isZip = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) =>
      String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)),
    )
    .replace(/&amp;/g, "&");
const strip = (xml: string) => decode(xml.replace(/<[^>]+>/g, ""));

/** Reads the named files of a zip, refusing a bomb: too many entries, or more bytes than the limit once unpacked. */
function unzip(bytes: Uint8Array, want: (name: string) => boolean) {
  let entries = 0;
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        if (++entries > MAX_ZIP_ENTRIES)
          throw new DocumentError("TOO_BIG", "This file has too many parts to read.");
        if (!want(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_ZIP_BYTES)
          throw new DocumentError("TOO_BIG", "This file is too big once unpacked.");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof DocumentError) throw e;
    throw new DocumentError(
      "UNREADABLE",
      "This file could not be opened. It may be damaged or protected by a password.",
    );
  }
}

const part = (files: Record<string, Uint8Array>, name: string) =>
  files[name] ? strFromU8(files[name]!) : "";

function docx(bytes: Uint8Array) {
  const files = unzip(bytes, (n) => n === "word/document.xml");
  const xml = part(files, "word/document.xml");
  if (!xml) throw new DocumentError("UNREADABLE", "This is not a Word document.");
  return strip(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:p>/g, "\n"),
  );
}

function pptx(bytes: Uint8Array) {
  const files = unzip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = Object.keys(files)
    .map((n) => ({ n, i: Number(n.match(/slide(\d+)\.xml$/)![1]) }))
    .sort((a, b) => a.i - b.i);
  if (!slides.length) throw new DocumentError("UNREADABLE", "This is not a PowerPoint file.");
  return slides
    .map((s) => `--- Slide ${s.i} ---\n${strip(part(files, s.n).replace(/<\/a:p>/g, "\n")).trim()}`)
    .join("\n\n");
}

const column = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function xlsx(bytes: Uint8Array) {
  const files = unzip(
    bytes,
    (n) =>
      n === "xl/sharedStrings.xml" ||
      n === "xl/workbook.xml" ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
  );
  const shared = [
    ...part(files, "xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
  ].map((m) => decode([...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const names = [...part(files, "xl/workbook.xml").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map(
    (m) => decode(m[1]!),
  );
  const sheets = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .map((n) => ({ n, i: Number(n.match(/sheet(\d+)\.xml$/)![1]) }))
    .sort((a, b) => a.i - b.i);
  if (!sheets.length) throw new DocumentError("UNREADABLE", "This is not an Excel file.");
  return sheets
    .map((s, k) => {
      const rows: string[] = [];
      for (const row of part(files, s.n).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        if (rows.length >= MAX_ROWS) break;
        const cells: string[] = [];
        for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1] ?? "";
          const at = column(attrs.match(/\br="([A-Z]+\d+)"/)?.[1] ?? "A1");
          if (at >= MAX_COLS) continue;
          const type = attrs.match(/\bt="([^"]*)"/)?.[1];
          const inner = c[2] ?? "";
          const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const value =
            type === "s"
              ? (shared[Number(v)] ?? "")
              : type === "inlineStr"
                ? decode(
                    [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""),
                  )
                : decode(v ?? "");
          while (cells.length < at) cells.push("");
          cells[at] = value.replace(/[\t\r\n]+/g, " ");
        }
        rows.push(cells.join("\t").replace(/\t+$/, ""));
      }
      return `## ${names[k] ?? `Sheet ${s.i}`}\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

async function pdf(bytes: Uint8Array) {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new DocumentError(
      "UNREADABLE",
      "This PDF could not be opened. It may be damaged or protected by a password.",
    );
  }
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const out: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(
      content.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim(),
    );
  }
  // The serverless build of pdf.js frees what it holds when the proxy goes; `destroy` is not always there.
  await (doc as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  return {
    text: out.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join("\n\n"),
    cut: doc.numPages > MAX_PDF_PAGES ? doc.numPages : 0,
  };
}

/** Text of a document for a bot, at most 256 KB of it. Throws a DocumentError with a sentence for the person. */
export async function extractDocument(bytes: Uint8Array, kind: DocumentKind) {
  if (bytes.length > MAX_DOCUMENT_BYTES)
    throw new DocumentError("TOO_BIG", "A document can be up to 20 MB.");
  if (kind === "pdf" && !isPdf(bytes))
    throw new DocumentError("UNSUPPORTED", "This is not a PDF file.");
  if ((kind === "docx" || kind === "pptx" || kind === "xlsx") && !isZip(bytes))
    throw new DocumentError("UNSUPPORTED", `This is not a ${kind} file.`);
  if ((kind === "csv" || kind === "tsv") && bytes.subarray(0, 8192).includes(0))
    throw new DocumentError("UNSUPPORTED", "This is not a text table.");
  const work = async (): Promise<{ text: string; cutPages: number }> => {
    if (kind === "pdf") {
      const r = await pdf(bytes);
      return { text: r.text, cutPages: r.cut };
    }
    if (kind === "docx") return { text: docx(bytes), cutPages: 0 };
    if (kind === "pptx") return { text: pptx(bytes), cutPages: 0 };
    if (kind === "xlsx") return { text: xlsx(bytes), cutPages: 0 };
    const t = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    const lines = t.split(/\r?\n/);
    return { text: lines.slice(0, MAX_ROWS * 5).join("\n"), cutPages: 0 };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    work(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new DocumentError("UNREADABLE", "Reading this file took too long.")),
        DEADLINE_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const text = r.text.replace(/\n{4,}/g, "\n\n\n").trim();
  if (!text || (kind === "pdf" && !/[\p{L}\p{N}]/u.test(text.replace(/--- Page \d+ ---/g, ""))))
    throw new DocumentError(
      "EMPTY",
      "There is no text in this file that a bot can read. A scan has to be attached as pictures.",
    );
  const enc = new TextEncoder().encode(text);
  const truncated = enc.length > MAX_TEXT_BYTES;
  const kept = truncated
    ? new TextDecoder().decode(enc.subarray(0, MAX_TEXT_BYTES)).replace(/�$/, "")
    : text;
  const notes = [
    r.cutPages ? `only the first ${MAX_PDF_PAGES} of ${r.cutPages} pages were read` : "",
    truncated ? "the text was cut at 256 KB" : "",
  ].filter(Boolean);
  return { text: kept, truncated: Boolean(notes.length), note: notes.join("; ") };
}
