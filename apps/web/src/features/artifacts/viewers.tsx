import { unzipSync } from "fflate";
import { DownloadSimpleIcon, FileIcon, FolderIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ARTIFACT_HTML_CSP, ARTIFACT_HTML_SANDBOX } from "@zetta/core/artifact-csp";
import { Skeleton } from "@zetta/ui/components/skeleton";
import { CodeBlock } from "../chat/chat-copy";
import { Response } from "../chat/response";
import { Empty } from "../shared/ui";
import { contentUrl, fetchContent, formatSize, type Artifact } from "./artifacts-api";
import { parseCsv } from "./csv";

/** Text previews stop here; a bigger file offers the download instead of freezing the tab. */
const MAX_TEXT = 2 * 1024 * 1024;
/** A zip is opened in memory, so only small ones are. */
const MAX_ZIP = 50 * 1024 * 1024;
const MAX_ENTRY = 5 * 1024 * 1024;

const Download_ = ({ a, children }: { a: Artifact; children: ReactNode }) => (
  <a
    href={contentUrl(a.id, true)}
    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
  >
    <DownloadSimpleIcon aria-hidden="true" className="size-4" />
    {children}
  </a>
);
const TooBig = ({ a }: { a: Artifact }) => (
  <Empty>
    This file is too large to preview ({formatSize(a.size)}). <Download_ a={a}>Download</Download_>
  </Empty>
);

/** `undefined` while loading, `null` when the file cannot be read. */
function useLoaded<T>(load: () => Promise<T>, deps: unknown[]) {
  const [value, setValue] = useState<T | null | undefined>();
  useEffect(() => {
    let live = true;
    setValue(undefined);
    load().then(
      (v) => live && setValue(v),
      () => live && setValue(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
const useText = (a: Artifact) => useLoaded(() => fetchContent(a.id).then((r) => r.text()), [a.id]);
function useObjectUrl(a: Artifact) {
  const blob = useLoaded(() => fetchContent(a.id).then((r) => r.blob()), [a.id]);
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : blob), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

const Loading = () => <Skeleton className="h-64 w-full" />;
const Gone = () => <Empty>This file is not available any more.</Empty>;

/** A page the bot wrote. Scripts run, but in an iframe with no same-origin access: no cookies, no way to call the API. */
function HtmlViewer({ a }: { a: Artifact }) {
  const text = useText(a);
  if (text === undefined) return <Loading />;
  if (text === null) return <Gone />;
  return (
    <iframe
      srcDoc={text}
      title={a.title}
      sandbox={ARTIFACT_HTML_SANDBOX}
      {...{ csp: ARTIFACT_HTML_CSP }}
      className="h-[75vh] w-full rounded-lg border border-border"
    />
  );
}

function TextViewer({ a }: { a: Artifact }) {
  const text = useText(a);
  const body = useMemo(() => {
    if (!text || a.kind !== "json") return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }, [text, a.kind]);
  if (body === undefined) return <Loading />;
  if (body === null) return <Gone />;
  return a.kind === "markdown" ? (
    <div className="rounded-lg border bg-card p-5">
      <Response text={body} />
    </div>
  ) : (
    <CodeBlock text={body} />
  );
}

function CsvViewer({ a }: { a: Artifact }) {
  const text = useText(a);
  const parsed = useMemo(
    () => (text == null ? text : parseCsv(text, /\.tsv$/i.test(a.fileName) ? "\t" : ",")),
    [text, a.fileName],
  );
  if (parsed === undefined) return <Loading />;
  if (parsed === null) return <Gone />;
  const [head = [], ...body] = parsed.rows;
  return (
    <div className="space-y-2">
      <div className="max-h-[75vh] overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {head.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-left font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {body.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-1.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {parsed.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first 1000 rows. Download the file for the rest.
        </p>
      )}
    </div>
  );
}

function ImageViewer({ a }: { a: Artifact }) {
  const src = useObjectUrl(a);
  if (src === undefined) return <Loading />;
  if (src === null) return <Gone />;
  return (
    <img
      src={src}
      alt={a.title}
      className="mx-auto max-h-[75vh] max-w-full rounded-lg border bg-muted/30"
    />
  );
}

const ENTRY_TEXT = /\.(txt|md|csv|tsv|json|html?|css|js|ts|tsx|jsx|py|sh|sql|ya?ml|toml|xml|log)$/i;
const ENTRY_IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
type Entry = { name: string; size: number };

function ZipViewer({ a }: { a: Artifact }) {
  const data = useLoaded(
    () =>
      a.size > MAX_ZIP
        ? Promise.resolve(undefined)
        : fetchContent(a.id).then(async (r) => new Uint8Array(await r.arrayBuffer())),
    [a.id],
  );
  const entries = useMemo(() => {
    if (!data) return data;
    const found: Entry[] = [];
    try {
      // The filter lists every entry and extracts none, so listing a big archive stays cheap.
      unzipSync(data, {
        filter: (f) => {
          found.push({ name: f.name, size: f.originalSize });
          return false;
        },
      });
    } catch {
      return null;
    }
    return found;
  }, [data]);
  const [open, setOpen] = useState<string>();
  if (a.size > MAX_ZIP) return <TooBig a={a} />;
  if (data === undefined || entries === undefined) return <Loading />;
  if (data === null || entries === null)
    return (
      <Empty>
        This zip cannot be read. <Download_ a={a}>Download</Download_>
      </Empty>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ul
        className="max-h-[75vh] divide-y overflow-auto rounded-lg border bg-card"
        aria-label="Files in the zip"
      >
        {entries.map((e) => {
          const dir = e.name.endsWith("/");
          const Icon = dir ? FolderIcon : FileIcon;
          return (
            <li key={e.name}>
              <button
                type="button"
                disabled={dir}
                onClick={() => setOpen(e.name)}
                aria-current={open === e.name}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent aria-[current=true]:bg-muted"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {!dir && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatSize(e.size)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-0">
        {open ? (
          <ZipEntry data={data} entry={entries.find((e) => e.name === open)!} />
        ) : (
          <Empty>Pick a file to preview it.</Empty>
        )}
      </div>
    </div>
  );
}

function ZipEntry({ data, entry }: { data: Uint8Array; entry: Entry }) {
  const bytes = useMemo(() => {
    if (entry.size > MAX_ENTRY) return undefined;
    try {
      return unzipSync(data, { filter: (f) => f.name === entry.name })[entry.name];
    } catch {
      return undefined;
    }
  }, [data, entry]);
  const image = ENTRY_IMAGE.test(entry.name);
  const url = useMemo(
    () =>
      bytes && image
        ? URL.createObjectURL(
            new Blob([bytes as BlobPart], {
              type: /\.svg$/i.test(entry.name) ? "image/svg+xml" : "",
            }),
          )
        : undefined,
    [bytes, image, entry.name],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!bytes) return <Empty>This file is too large to preview. Download the zip to open it.</Empty>;
  if (url)
    return <img src={url} alt={entry.name} className="max-h-[75vh] max-w-full rounded-lg border" />;
  if (ENTRY_TEXT.test(entry.name)) return <CodeBlock text={new TextDecoder().decode(bytes)} />;
  return <Empty>No preview for this type of file. Download the zip to open it.</Empty>;
}

/** The preview for one artifact, chosen by its kind. Media and PDF load straight from the server so they can stream and seek. */
export function ArtifactViewer({ a }: { a: Artifact }) {
  const src = contentUrl(a.id);
  switch (a.kind) {
    case "html":
      return a.size > MAX_TEXT * 5 ? <TooBig a={a} /> : <HtmlViewer a={a} />;
    case "markdown":
    case "text":
    case "code":
    case "json":
      return a.size > MAX_TEXT ? <TooBig a={a} /> : <TextViewer a={a} />;
    case "csv":
      return a.size > MAX_TEXT ? <TooBig a={a} /> : <CsvViewer a={a} />;
    case "image":
      return <ImageViewer a={a} />;
    case "video":
      return (
        <video
          src={src}
          controls
          preload="metadata"
          className="mx-auto max-h-[75vh] max-w-full rounded-lg border bg-black"
        />
      );
    case "audio":
      return <audio src={src} controls preload="metadata" className="w-full" />;
    case "pdf":
      return <iframe title={a.title} src={src} className="h-[80vh] w-full rounded-lg border" />;
    case "zip":
      return <ZipViewer a={a} />;
    default:
      return (
        <Empty>
          No preview for this type of file ({a.mimeType}). <Download_ a={a}>Download</Download_>
        </Empty>
      );
  }
}
