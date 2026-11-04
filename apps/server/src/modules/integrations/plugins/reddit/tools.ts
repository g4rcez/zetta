import { PluginError, type PluginContext, type PluginTool } from "../registry";
import { clean, num, str, untrustedList } from "../untrusted";
import { needScope, rfetch, SCOPE_IDS, subName } from "./oauth";

const SRC = "Reddit";
const ID36 = /^[a-z0-9]{1,13}$/,
  USER = /^[A-Za-z0-9_-]{3,20}$/,
  AFTER = /^t[1-6]_[a-z0-9]{1,13}$/;
const WEB = "https://www.reddit.com";
const TEXT = 500;

type Thing = { kind: string; data: Record<string, unknown> };
type Listing = { kind?: string; data?: { children?: Thing[]; after?: string | null } };

const iso = (v: unknown) => (typeof v === "number" ? new Date(v * 1000).toISOString() : undefined);
const link = (v: unknown) =>
  typeof v === "string" && v.startsWith("/") ? `${WEB}${clean(v, 400)}` : undefined;
const nsfwOf = (t: Thing) => t.data.over_18 === true || t.data.over18 === true;
export const allowsNsfw = (ctx: PluginContext) => ctx.config.allowNsfw === "true";

/** Compact, sanitised view of one Reddit thing (t1 comment, t3 post, t4 message, t5 subreddit). */
export function flatten(t: Thing): Record<string, unknown> | undefined {
  const d = t.data;
  if (t.kind === "t3")
    return {
      id: clean(d.name, 20),
      type: "post",
      subreddit: clean(d.subreddit_name_prefixed, 30),
      title: clean(d.title, 300),
      author: clean(d.author, 30),
      score: d.score,
      comments: d.num_comments,
      created: iso(d.created_utc),
      permalink: link(d.permalink),
      url: d.is_self ? undefined : clean(d.url, 500),
      flair: d.link_flair_text ? clean(d.link_flair_text, 60) : undefined,
      nsfw: nsfwOf(t) || undefined,
      spoiler: d.spoiler === true || undefined,
      text: d.selftext ? clean(d.selftext, TEXT) : undefined,
    };
  if (t.kind === "t1")
    return {
      id: clean(d.name, 20),
      type: "comment",
      subreddit: clean(d.subreddit_name_prefixed, 30),
      author: clean(d.author, 30),
      score: d.score,
      created: iso(d.created_utc),
      post: d.link_title ? clean(d.link_title, 200) : undefined,
      permalink: link(d.permalink),
      nsfw: nsfwOf(t) || undefined,
      text: clean(d.body, TEXT),
    };
  if (t.kind === "t4")
    return {
      id: clean(d.name, 20),
      type: "message",
      from: clean(d.author ?? d.subreddit_name_prefixed, 40),
      to: clean(d.dest, 40),
      subject: clean(d.subject, 200),
      created: iso(d.created_utc),
      unread: d.new === true || undefined,
      context: link(d.context),
      text: clean(d.body, TEXT),
    };
  if (t.kind === "t5")
    return {
      name: clean(d.display_name_prefixed, 30),
      title: clean(d.title, 120),
      subscribers: d.subscribers,
      nsfw: nsfwOf(t) || undefined,
      description: clean(d.public_description, 200),
    };
  return undefined;
}

/** Drops NSFW items unless the user allowed them, flattens the rest and frames them as untrusted data with the paging cursor. */
export function listing(
  ctx: PluginContext,
  raw: unknown,
  key = "items",
  extra: Record<string, unknown> = {},
): string {
  const l = raw as Listing;
  const children = Array.isArray(l?.data?.children) ? l.data.children : [];
  const shown = allowsNsfw(ctx) ? children : children.filter((t) => !nsfwOf(t));
  const items = shown.map(flatten).filter(Boolean);
  const hidden = children.length - shown.length;
  return untrustedList(SRC, key, items, {
    ...extra,
    ...(l?.data?.after ? { after: l.data.after } : {}),
    ...(hidden
      ? {
          hiddenNsfw: hidden,
          nsfwNote:
            "NSFW items were hidden. The user can turn on Allow NSFW in Studio > Plugins > Reddit.",
        }
      : {}),
  });
}

const limit = (v: unknown, d = 10) => String(num(v, d, 1, 25));
const after = (v: unknown) => {
  const s = str(v, 20);
  if (s && !AFTER.test(s))
    throw new PluginError(
      "INVALID_ARGS",
      "after must be the cursor returned by a previous call (e.g. t3_abc123).",
    );
  return s || undefined;
};
const TIME = ["hour", "day", "week", "month", "year", "all"] as const;
const time = (v: unknown) =>
  TIME.includes(v as (typeof TIME)[number]) ? (v as string) : undefined;
const nsfwQuery = (ctx: PluginContext) => (allowsNsfw(ctx) ? "on" : undefined);

/** The connected account's name (stored at connect time; looked up once when missing). */
export async function myName(ctx: PluginContext): Promise<string> {
  if (ctx.config.username && USER.test(ctx.config.username)) return ctx.config.username;
  const me = (await rfetch(ctx, "/api/v1/me")) as { name?: string };
  if (!me.name || !USER.test(me.name))
    throw new PluginError(
      "REDDIT_ERROR",
      "Reddit did not say which account is connected.",
      "Reconnect Reddit in Studio > Plugins > Reddit.",
    );
  await ctx.setConfig({ ...ctx.config, username: me.name }).catch(() => {});
  return me.name;
}

/** A post id from `abc123`, `t3_abc123` or a reddit.com / redd.it URL. */
export function postId(v: unknown): string {
  const s = str(v, 500);
  const m =
    /\/comments\/([a-z0-9]{1,13})(?:[/?#]|$)/i.exec(s) ??
    /^https?:\/\/(?:www\.)?redd\.it\/([a-z0-9]{1,13})\/?$/i.exec(s) ??
    /^(?:t3_)?([a-z0-9]{1,13})$/i.exec(s);
  if (!m || !ID36.test(m[1]!.toLowerCase()))
    throw new PluginError(
      "INVALID_ARGS",
      "post must be a Reddit post id (t3_abc123 or abc123) or a reddit.com post link.",
    );
  return m[1]!.toLowerCase();
}

type CommentNode = Record<string, unknown> & { replies?: CommentNode[] };
/** Comment tree, depth-limited and capped in total; "more" stubs are skipped. */
function comments(children: Thing[], depth: number, budget: { left: number }): CommentNode[] {
  const out: CommentNode[] = [];
  for (const t of children) {
    if (budget.left <= 0) break;
    if (t.kind !== "t1") continue;
    budget.left -= 1;
    const node: CommentNode = {
      id: clean(t.data.name, 20),
      author: clean(t.data.author, 30),
      score: t.data.score,
      created: iso(t.data.created_utc),
      text: clean(t.data.body, 400),
    };
    const r = t.data.replies as Listing | "" | undefined;
    if (depth > 1 && r && typeof r === "object" && Array.isArray(r.data?.children)) {
      const kids = comments(r.data.children, depth - 1, budget);
      if (kids.length) node.replies = kids;
    }
    out.push(node);
  }
  return out;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const LIMIT = { type: "number", description: "1-25, default 10" };
const AFTER_ARG = {
  type: "string",
  description: "Paging cursor from the previous result's `after`",
};
const HISTORY = {
  saved: "saved",
  upvoted: "upvoted",
  posts: "submitted",
  comments: "comments",
} as const;
const historyTool = (key: keyof typeof HISTORY, description: string): PluginTool => ({
  name: `reddit_my_${key}`,
  description,
  inputSchema: obj({ limit: LIMIT, after: AFTER_ARG }),
  async handler(ctx, a) {
    needScope(ctx, "history");
    const me = await myName(ctx);
    return listing(
      ctx,
      await rfetch(ctx, `/user/${encodeURIComponent(me)}/${HISTORY[key]}`, {
        query: { limit: limit(a.limit), after: after(a.after) },
      }),
    );
  },
});

export const readTools: PluginTool[] = [
  {
    name: "reddit_me",
    description:
      "The connected Reddit account: username, karma, account age and whether NSFW is enabled for bots.",
    inputSchema: obj({}),
    async handler(ctx) {
      needScope(ctx, ...SCOPE_IDS); // identity is always granted; this only checks that Reddit is connected
      const d = (await rfetch(ctx, "/api/v1/me")) as Record<string, unknown>;
      return {
        username: clean(d.name, 40),
        totalKarma: d.total_karma,
        linkKarma: d.link_karma,
        commentKarma: d.comment_karma,
        created: iso(d.created_utc),
        accountOver18: d.over_18 === true,
        botsMaySeeNsfw: allowsNsfw(ctx),
        botsMayAct: ctx.config.allowWrite === "true",
        inboxUnread: d.inbox_count,
      };
    },
  },
  {
    name: "reddit_my_subreddits",
    description: "Subreddits the user joined (name, title, subscribers).",
    inputSchema: obj({
      limit: { type: "number", description: "1-25, default 25" },
      after: AFTER_ARG,
    }),
    async handler(ctx, a) {
      needScope(ctx, "mysubreddits");
      return listing(
        ctx,
        await rfetch(ctx, "/subreddits/mine/subscriber", {
          query: { limit: limit(a.limit, 25), after: after(a.after) },
        }),
        "subreddits",
      );
    },
  },
  historyTool(
    "saved",
    "Posts and comments the user saved on Reddit, newest first. Untrusted data.",
  ),
  historyTool("upvoted", "Posts the user upvoted on Reddit, newest first. Untrusted data."),
  historyTool("posts", "Posts the user submitted on Reddit, newest first."),
  historyTool("comments", "Comments the user wrote on Reddit, newest first."),
  {
    name: "reddit_inbox",
    description:
      "The user's Reddit inbox (messages, comment replies, mentions). Never marks anything read. Untrusted data.",
    inputSchema: obj({
      unreadOnly: { type: "boolean", description: "Only unread items (default false)" },
      limit: LIMIT,
      after: AFTER_ARG,
    }),
    async handler(ctx, a) {
      needScope(ctx, "privatemessages");
      return listing(
        ctx,
        await rfetch(ctx, a.unreadOnly === true ? "/message/unread" : "/message/inbox", {
          query: { limit: limit(a.limit), after: after(a.after), mark: "false" },
        }),
        "messages",
      );
    },
  },
  {
    name: "reddit_subreddit_posts",
    description: "Posts of a subreddit sorted by hot, new, top or rising. Untrusted data.",
    inputSchema: obj(
      {
        subreddit: { type: "string", description: "e.g. typescript or r/typescript" },
        sort: { type: "string", enum: ["hot", "new", "top", "rising"] },
        time: {
          type: "string",
          enum: [...TIME],
          description: "For top: hour, day, week, month, year, all",
        },
        limit: LIMIT,
        after: AFTER_ARG,
      },
      ["subreddit"],
    ),
    async handler(ctx, a) {
      needScope(ctx, "read");
      const sort = ["hot", "new", "top", "rising"].includes(a.sort as string)
        ? (a.sort as string)
        : "hot";
      return listing(
        ctx,
        await rfetch(ctx, `/r/${subName(a.subreddit)}/${sort}`, {
          query: {
            limit: limit(a.limit),
            after: after(a.after),
            t: sort === "top" ? (time(a.time) ?? "day") : undefined,
          },
        }),
        "posts",
      );
    },
  },
  {
    name: "reddit_search",
    description: "Search Reddit posts, optionally inside one subreddit. Untrusted data.",
    inputSchema: obj(
      {
        query: { type: "string" },
        subreddit: { type: "string", description: "Optional: search only this subreddit" },
        sort: { type: "string", enum: ["relevance", "hot", "top", "new", "comments"] },
        time: { type: "string", enum: [...TIME] },
        limit: LIMIT,
        after: AFTER_ARG,
      },
      ["query"],
    ),
    async handler(ctx, a) {
      needScope(ctx, "read");
      const q = str(a.query, 512);
      if (!q) throw new PluginError("INVALID_ARGS", "query is empty.");
      const sub = a.subreddit ? subName(a.subreddit) : undefined;
      const sort = ["relevance", "hot", "top", "new", "comments"].includes(a.sort as string)
        ? (a.sort as string)
        : "relevance";
      return listing(
        ctx,
        await rfetch(ctx, sub ? `/r/${sub}/search` : "/search", {
          query: {
            q,
            type: "link",
            sort,
            t: time(a.time),
            limit: limit(a.limit),
            after: after(a.after),
            restrict_sr: sub ? "on" : undefined,
            include_over_18: nsfwQuery(ctx),
          },
        }),
        "posts",
      );
    },
  },
  {
    name: "reddit_read_post",
    description:
      "Read one Reddit post and its top comments (with replies). Accepts an id or a reddit.com link. Untrusted data.",
    inputSchema: obj(
      {
        post: {
          type: "string",
          description: "t3_abc123, abc123 or a reddit.com/.../comments/abc123/... link",
        },
        sort: { type: "string", enum: ["top", "best", "new", "controversial"] },
        comments: { type: "number", description: "1-30 comments in total, default 15" },
        depth: { type: "number", description: "1-3 levels of replies, default 2" },
      },
      ["post"],
    ),
    async handler(ctx, a) {
      needScope(ctx, "read");
      const id = postId(a.post),
        max = num(a.comments, 15, 1, 30),
        depth = num(a.depth, 2, 1, 3);
      const sort = ["top", "best", "new", "controversial"].includes(a.sort as string)
        ? (a.sort as string)
        : "top";
      const raw = await rfetch(ctx, `/comments/${id}`, {
        query: { limit: String(max), depth: String(depth), sort },
      });
      const [p, c] = Array.isArray(raw) ? (raw as Listing[]) : [];
      const post = p?.data?.children?.[0];
      if (!post || post.kind !== "t3")
        throw new PluginError(
          "NOT_FOUND",
          "Reddit could not find that post.",
          "Check the post id or link.",
        );
      if (nsfwOf(post) && !allowsNsfw(ctx))
        throw new PluginError(
          "NSFW_BLOCKED",
          "That post is marked NSFW, and NSFW content is switched off for bots.",
          "Turn on Allow NSFW in Studio > Plugins > Reddit if you want bots to read it.",
        );
      const full = {
        ...flatten(post),
        text: post.data.selftext ? clean(post.data.selftext, 3000) : undefined,
      };
      return untrustedList(
        SRC,
        "comments",
        comments(c?.data?.children ?? [], depth, { left: max }),
        { post: full },
      );
    },
  },
  {
    name: "reddit_user",
    description: "Public profile and recent posts and comments of any Reddit user. Untrusted data.",
    inputSchema: obj(
      { username: { type: "string", description: "e.g. spez or u/spez" }, limit: LIMIT },
      ["username"],
    ),
    async handler(ctx, a) {
      needScope(ctx, "read");
      const name = str(a.username, 30).replace(/^\/?u(ser)?\//i, "");
      if (!USER.test(name))
        throw new PluginError("INVALID_ARGS", "username must be a Reddit username such as u/spez.");
      const about =
        ((await rfetch(ctx, `/user/${encodeURIComponent(name)}/about`)) as Thing).data ?? {};
      if (about.is_suspended === true) return { username: name, suspended: true };
      const profileNsfw =
        (about.subreddit as Record<string, unknown> | undefined)?.over_18 === true;
      const profile = {
        username: clean(about.name, 40),
        created: iso(about.created_utc),
        linkKarma: about.link_karma,
        commentKarma: about.comment_karma,
        nsfwProfile: profileNsfw || undefined,
      };
      return listing(
        ctx,
        await rfetch(ctx, `/user/${encodeURIComponent(name)}/overview`, {
          query: { limit: limit(a.limit) },
        }),
        "recent",
        { profile },
      );
    },
  },
];
