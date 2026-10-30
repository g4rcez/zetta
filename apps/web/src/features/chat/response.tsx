import { memo, useMemo } from "react";
import { Streamdown } from "streamdown";

import { splitReply, UI_FENCE } from "@zetta/render/reply";
import { cn } from "@zetta/ui/lib/utils";

import { stripToolFences } from "./tool-fences";
import { UiSkeleton, UiView } from "./ui-registry";
import { parseWhatsapp, WhatsappView } from "./whatsapp-view";

const BODY = "chat-response min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/**
 * A reply can carry text from outside (a web page, an email) that makes the bot write `![x](https://host/?d=private)`; drawing the
 * image would send that request as soon as the reply renders. Show the alt text instead.
 */
const NO_REMOTE_IMAGES = {
  img: ({ alt }: { alt?: string | undefined }) =>
    alt ? <span className="text-muted-foreground">[{alt}]</span> : null,
};

const Markdown = memo(function Markdown({
  text,
  streaming,
  className,
}: {
  text: string;
  streaming: boolean;
  className?: string | undefined;
}) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      className={cn(BODY, className)}
      components={NO_REMOTE_IMAGES}
    >
      {text}
    </Streamdown>
  );
});

/**
 * Message body. Markdown goes through Streamdown, which tolerates half-written syntax while a reply streams; fenced `zetta:ui`
 * blocks are drawn by json-render from the shared catalog (a block that never validates is shown as the code it is).
 */
const WA = /```zetta:whatsapp\s*\n([\s\S]*?)```/g;

export const Response = memo(function Response({
  text: raw,
  streaming = false,
  className,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const text = streaming ? stripToolFences(raw) : raw;
  const whatsapp = !streaming && text.includes("```zetta:whatsapp");
  // Hooks stay above the early return (a reply can flip to the WhatsApp view when it settles). A reply with no ui fence skips the parse on every chunk.
  const segments = useMemo(
    () => (whatsapp || !text.includes("```" + UI_FENCE) ? [] : splitReply(text, streaming)),
    [text, streaming, whatsapp],
  );
  if (whatsapp) {
    const parts: { md?: string; wa?: ReturnType<typeof parseWhatsapp>; raw?: string }[] = [];
    let last = 0;
    for (const m of text.matchAll(WA)) {
      if (m.index! > last) parts.push({ md: text.slice(last, m.index) });
      parts.push({ wa: parseWhatsapp(m[1]!), raw: m[1]! });
      last = m.index! + m[0].length;
    }
    if (last < text.length) parts.push({ md: text.slice(last) });
    return (
      <div className={cn("flex min-w-0 flex-col gap-2", className)}>
        {parts.map((p, i) =>
          p.md !== undefined ? (
            p.md.trim() ? (
              <Response key={i} text={p.md} />
            ) : null
          ) : p.wa ? (
            <WhatsappView key={i} data={p.wa} />
          ) : (
            <Markdown key={i} text={`\`\`\`json\n${p.raw}\n\`\`\``} streaming={false} />
          ),
        )}
      </div>
    );
  }
  if (segments.every((s) => s.kind === "markdown"))
    return <Markdown text={text} streaming={streaming} className={className} />;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {segments.map((s, i) =>
        s.kind === "markdown" ? (
          <Markdown key={i} text={s.text} streaming={streaming && i === segments.length - 1} />
        ) : s.spec ? (
          <UiView key={i} spec={s.spec} streaming={!s.complete} />
        ) : s.complete ? (
          <Markdown key={i} text={`\`\`\`json\n${s.raw}\n\`\`\``} streaming={false} />
        ) : (
          <UiSkeleton key={i} />
        ),
      )}
    </div>
  );
});
