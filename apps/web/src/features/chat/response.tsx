import { memo, useMemo } from "react";
import { Streamdown } from "streamdown";

import { splitReply } from "@zetta/render/reply";
import { cn } from "@zetta/ui/lib/utils";

import { UiSkeleton, UiView } from "./ui-registry";

const BODY = "chat-response min-w-0 text-[15px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

const Markdown = memo(function Markdown({ text, streaming, className }: { text: string; streaming: boolean; className?: string | undefined }) {
  return (
    <Streamdown mode={streaming ? "streaming" : "static"} isAnimating={streaming} parseIncompleteMarkdown={streaming} className={cn(BODY, className)}>
      {text}
    </Streamdown>
  );
});

/**
 * Message body. Markdown goes through Streamdown, which tolerates half-written syntax while a reply streams; fenced `zetta:ui`
 * blocks are drawn by json-render from the shared catalog (a block that never validates is shown as the code it is).
 */
export const Response = memo(function Response({ text, streaming = false, className }: { text: string; streaming?: boolean; className?: string }) {
  const segments = useMemo(() => splitReply(text, streaming), [text, streaming]);
  if (segments.every((s) => s.kind === "markdown")) return <Markdown text={text} streaming={streaming} className={className} />;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {segments.map((s, i) => s.kind === "markdown"
        ? <Markdown key={i} text={s.text} streaming={streaming && i === segments.length - 1} />
        : s.spec ? <UiView key={i} spec={s.spec} streaming={!s.complete} />
        : s.complete ? <Markdown key={i} text={`\`\`\`json\n${s.raw}\n\`\`\``} streaming={false} />
        : <UiSkeleton key={i} />)}
    </div>
  );
});
