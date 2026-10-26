import { Fragment, type ReactNode } from "react";

import { CodeBlock } from "./chat-copy";

/** Safe Markdown subset rendered as React elements (no HTML injection): fenced code, headings, bullet and numbered lists, bold, italic, inline code, links. */
export type Block =
  | { type: "code"; text: string }
  | { type: "heading"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[]; start: number }
  | { type: "p"; text: string };

const bullet = /^[-*]\s/, numbered = /^(\d{1,9})[.)]\s/;

/** Pure block parser (exported for tests). */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      blocks.push({ type: "code", text: code.join("\n") });
    } else if (/^#{1,3}\s/.test(line)) blocks.push({ type: "heading", text: line.replace(/^#+\s/, "") });
    else if (bullet.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && bullet.test(lines[i]!); i++) items.push(lines[i]!.slice(2));
      i--; blocks.push({ type: "ul", items });
    } else if (numbered.test(line)) {
      const items: string[] = [], start = Number(numbered.exec(line)![1]);
      for (; i < lines.length && numbered.test(lines[i]!); i++) items.push(lines[i]!.replace(numbered, ""));
      i--; blocks.push({ type: "ol", items, start });
    } else if (line.trim()) blocks.push({ type: "p", text: line });
  }
  return blocks;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={i++} className="chat-inline-code">{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={i++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("*")) out.push(<em key={i++}>{t.slice(1, -1)}</em>);
    else out.push(<a key={i++} href={m[2]} target="_blank" rel="noopener noreferrer nofollow" className="underline">{t.slice(1, t.indexOf("]"))}</a>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source).map((b, k) => {
    if (b.type === "code") return <CodeBlock key={k} text={b.text} />;
    if (b.type === "heading") return <p key={k} className="font-semibold">{inline(b.text)}</p>;
    if (b.type === "ul") return <ul key={k} className="list-disc pl-5">{b.items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ul>;
    if (b.type === "ol") return <ol key={k} start={b.start} className="list-decimal pl-5">{b.items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ol>;
    return <p key={k} className="break-words">{inline(b.text)}</p>;
  });
  return <Fragment>{blocks}</Fragment>;
}
