import { PluginError, type PluginContext, type PluginTool } from "../registry";
import { str } from "../untrusted";
import { allowlist, clean, needScope, rfetch, subName, type ScopeId } from "./oauth";
import { allowsNsfw } from "./tools";

/**
 * Outward actions on the user's Reddit account. Each needs (1) its own Reddit scope, ticked by the user at connect time and re-checked
 * against what Reddit granted, (2) the per-install `allowWrite` switch (default off), (3) when the user set one, the subreddit allowlist
 * (posts, comments, votes and joins only; saving, editing your own content and private messages are not tied to a subreddit), and
 * (4) a per-user rate limit. Votes have a much tighter limit: Reddit's rules forbid automated or bulk voting.
 */
const WRITES_PER_MIN = 5, WRITES_PER_HOUR = 30, VOTES_PER_HOUR = 10;
const FULLNAME = /^t[1-6]_[a-z0-9]{1,13}$/, USER = /^[A-Za-z0-9_-]{3,20}$/;
const DISABLED = () => new PluginError("WRITE_DISABLED", "Acting on Reddit is switched off for this plugin.", "Open Studio > Plugins > Reddit, turn on 'Allow bots to act on my account', then ask again.");

const log = new Map<string, number[]>(); // `${userId}:${bucket}` -> timestamps (in memory; resets on restart)
function rateLimit(userId: string, bucket: "write" | "vote", now = Date.now()) {
  const key = `${userId}:${bucket}`, list = (log.get(key) ?? []).filter((t) => now - t < 3_600_000);
  const hour = bucket === "vote" ? VOTES_PER_HOUR : WRITES_PER_HOUR;
  if (list.length >= hour || (bucket === "write" && list.filter((t) => now - t < 60_000).length >= WRITES_PER_MIN))
    throw new PluginError("RATE_LIMITED", bucket === "vote" ? `The Reddit voting limit was reached (${VOTES_PER_HOUR} an hour).` : `The Reddit action limit was reached (${WRITES_PER_MIN} a minute, ${WRITES_PER_HOUR} an hour).`, "Wait a while and ask again.");
  list.push(now); log.set(key, list);
}
/** Test helper. */
export const resetRedditLimits = () => log.clear();

/** Subreddit (lowercase) a post or comment lives in, through /api/info. */
async function subredditOf(ctx: PluginContext, fullname: string): Promise<string | undefined> {
  const r = await rfetch(ctx, "/api/info", { query: { id: fullname } }) as { data?: { children?: { data?: { subreddit?: string } }[] } };
  return r.data?.children?.[0]?.data?.subreddit?.toLowerCase();
}
/** Opt-in switch, scope, allowlist and rate limit for one action. `sub` is a subreddit name or a thing to look up (null: not subreddit bound). */
async function guard(ctx: PluginContext, scope: ScopeId, sub: { name: string } | { thing: string } | null, bucket: "write" | "vote" = "write") {
  needScope(ctx, scope);
  if (ctx.config.allowWrite !== "true") throw DISABLED();
  const list = allowlist(ctx.config.subreddits, true);
  if (sub && (ctx.config.subreddits ?? "").trim()) {
    if ("thing" in sub) needScope(ctx, "read");
    const name = "name" in sub ? sub.name.toLowerCase() : await subredditOf(ctx, sub.thing);
    if (!name || !list.includes(name)) throw new PluginError("NOT_ALLOWED", `${name ? `r/${name}` : "That subreddit"} is not on the Reddit plugin's allowlist.`, "Add it under 'Only act in these subreddits' in Studio > Plugins > Reddit, or clear that list.");
  }
  rateLimit(ctx.userId, bucket);
}

const fullname = (v: unknown, kinds: string[], name = "id") => {
  const s = str(v, 20).toLowerCase();
  if (!FULLNAME.test(s) || !kinds.includes(s.slice(0, 2))) throw new PluginError("INVALID_ARGS", `${name} must be a Reddit fullname (${kinds.map((k) => `${k}_...`).join(" or ")}), as returned by the read tools.`);
  return s;
};
const text = (v: unknown, max: number, name = "text") => {
  const t = clean(v, max + 1).trim();
  if (!t) throw new PluginError("INVALID_ARGS", `${name} is empty.`);
  if (t.length > max) throw new PluginError("INVALID_ARGS", `${name} is longer than ${max} characters.`);
  return t;
};

/** Reddit's `api_type=json` errors ([[CODE, message, field], ...]) mapped to what the user can do. */
const ERRORS: Record<string, [string, string]> = {
  RATELIMIT: ["RATE_LIMITED", "Wait as long as Reddit says and ask again. New or low-karma accounts are limited more."],
  SUBREDDIT_NOEXIST: ["NOT_FOUND", "Check the subreddit name."],
  SUBREDDIT_NOTALLOWED: ["FORBIDDEN", "Only approved users can post there."],
  NO_SELFS: ["NOT_ALLOWED", "Post a link instead, or pick another subreddit."],
  NO_LINKS: ["NOT_ALLOWED", "Post text instead, or pick another subreddit."],
  TOO_OLD: ["NOT_ALLOWED", "That post is archived; pick a newer one."],
  THREAD_LOCKED: ["NOT_ALLOWED", "That thread is locked."],
  DELETED_COMMENT: ["NOT_FOUND", "That comment was deleted."],
  DELETED_LINK: ["NOT_FOUND", "That post was deleted."],
  USER_DOESNT_EXIST: ["NOT_FOUND", "Check the username."],
  NOT_AUTHOR: ["FORBIDDEN", "Only your own posts and comments can be edited or deleted."],
  BAD_URL: ["INVALID_ARGS", "Use a full https:// link."],
  ALREADY_SUB: ["INVALID_ARGS", "That link was already posted there; set resubmit to true to post it again."],
  SUBMIT_VALIDATION_FLAIR_REQUIRED: ["INVALID_ARGS", "That subreddit requires a post flair; pass flairId."],
};
function checked<T>(raw: unknown): T {
  const errors = (raw as { json?: { errors?: unknown[][] } })?.json?.errors;
  if (Array.isArray(errors) && errors.length) {
    const [code, msg] = errors[0] as [string, string];
    const [c, fix] = ERRORS[String(code)] ?? ["REDDIT_REFUSED", "Check the details in the message above and ask the bot to adjust the request."];
    throw new PluginError(c, `Reddit refused that: ${clean(msg || code, 200)}.`, fix);
  }
  return ((raw as { json?: { data?: T } })?.json?.data ?? {}) as T;
}
const thingOut = (d: { things?: { data?: Record<string, unknown> }[] }) => { const t = d.things?.[0]?.data ?? {}; return { id: clean(t.name ?? t.id, 20) || null, permalink: typeof t.permalink === "string" ? `https://www.reddit.com${clean(t.permalink, 400)}` : null }; };

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, properties, required, additionalProperties: false });
const PUBLIC = "This is a PUBLIC action on the user's own Reddit account: do it only when the user asked for it.";

export const writeTools: PluginTool[] = [
  { name: "reddit_submit_post", description: `Create a Reddit post (text or link) in a subreddit. ${PUBLIC}`,
    inputSchema: obj({ subreddit: { type: "string" }, title: { type: "string", description: "Up to 300 characters" }, text: { type: "string", description: "Markdown body for a text post (up to 20000)" }, url: { type: "string", description: "https:// link for a link post (instead of text)" },
      nsfw: { type: "boolean", description: "Mark as NSFW (only when NSFW is allowed)" }, spoiler: { type: "boolean" }, flairId: { type: "string" }, resubmit: { type: "boolean", description: "Post a link even if it was posted there before" } }, ["subreddit", "title"]),
    async handler(ctx, a) {
      const sr = subName(a.subreddit), title = text(a.title, 300, "title");
      const url = str(a.url, 2000);
      if (url && a.text) throw new PluginError("INVALID_ARGS", "Pass either text or url, not both.");
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new PluginError("INVALID_ARGS", "url must be a full http(s) link.");
      if (a.nsfw === true && !allowsNsfw(ctx)) throw new PluginError("NSFW_BLOCKED", "Posting NSFW content is switched off for bots.", "Turn on Allow NSFW in Studio > Plugins > Reddit.");
      const flair = str(a.flairId, 64); if (flair && !/^[A-Za-z0-9-]{1,64}$/.test(flair)) throw new PluginError("INVALID_ARGS", "flairId is not a valid flair template id.");
      await guard(ctx, "submit", { name: sr });
      const d = checked<{ url?: string; name?: string; id?: string }>(await rfetch(ctx, "/api/submit", { method: "POST", form: {
        sr, title, kind: url ? "link" : "self", ...(url ? { url } : { text: a.text === undefined ? "" : text(a.text, 20_000) }),
        nsfw: a.nsfw === true ? "true" : undefined, spoiler: a.spoiler === true ? "true" : undefined, flair_id: flair || undefined, resubmit: a.resubmit === true ? "true" : undefined, sendreplies: "true",
      } }));
      return { status: "posted", id: d.name ? clean(d.name, 20) : null, url: d.url ? clean(d.url, 400) : null };
    } },
  { name: "reddit_comment", description: `Reply to a Reddit post (t3_...) or comment (t1_...) with a markdown comment. ${PUBLIC}`,
    inputSchema: obj({ parent: { type: "string", description: "Fullname of the post or comment to reply to" }, text: { type: "string", description: "Markdown, up to 10000 characters" } }, ["parent", "text"]),
    async handler(ctx, a) {
      const parent = fullname(a.parent, ["t1", "t3"], "parent"), body = text(a.text, 10_000);
      await guard(ctx, "submit", { thing: parent });
      return { status: "commented", ...thingOut(checked(await rfetch(ctx, "/api/comment", { method: "POST", form: { thing_id: parent, text: body } }))) };
    } },
  { name: "reddit_vote", description: `Upvote (1), downvote (-1) or clear the vote (0) on a post or comment ("give karma"). Reddit forbids automated or bulk voting: only vote on items the user named, never in a loop. ${PUBLIC}`,
    inputSchema: obj({ id: { type: "string", description: "Fullname t1_... or t3_..." }, direction: { type: "number", enum: [1, 0, -1] } }, ["id", "direction"]),
    async handler(ctx, a) {
      const id = fullname(a.id, ["t1", "t3"]), dir = Number(a.direction);
      if (![1, 0, -1].includes(dir)) throw new PluginError("INVALID_ARGS", "direction must be 1, 0 or -1.");
      await guard(ctx, "vote", { thing: id }, "vote");
      checked(await rfetch(ctx, "/api/vote", { method: "POST", form: { id, dir: String(dir) } }));
      return { status: dir === 1 ? "upvoted" : dir === -1 ? "downvoted" : "vote_cleared", id };
    } },
  { name: "reddit_edit", description: `Replace the text of one of the user's own text posts or comments. ${PUBLIC}`,
    inputSchema: obj({ id: { type: "string", description: "Fullname t1_... or t3_..." }, text: { type: "string" } }, ["id", "text"]),
    async handler(ctx, a) {
      const id = fullname(a.id, ["t1", "t3"]), body = text(a.text, id.startsWith("t3") ? 20_000 : 10_000);
      await guard(ctx, "edit", null);
      return { status: "edited", ...thingOut(checked(await rfetch(ctx, "/api/editusertext", { method: "POST", form: { thing_id: id, text: body } }))) };
    } },
  { name: "reddit_delete", description: `Delete one of the user's own posts or comments. Cannot be undone. ${PUBLIC}`,
    inputSchema: obj({ id: { type: "string", description: "Fullname t1_... or t3_..." } }, ["id"]),
    async handler(ctx, a) {
      const id = fullname(a.id, ["t1", "t3"]);
      await guard(ctx, "edit", null);
      checked(await rfetch(ctx, "/api/del", { method: "POST", form: { id } }));
      return { status: "deleted", id };
    } },
  { name: "reddit_save", description: "Save (or unsave) a post or comment to the user's private Reddit saved list.",
    inputSchema: obj({ id: { type: "string", description: "Fullname t1_... or t3_..." }, unsave: { type: "boolean" } }, ["id"]),
    async handler(ctx, a) {
      const id = fullname(a.id, ["t1", "t3"]);
      await guard(ctx, "save", null);
      checked(await rfetch(ctx, a.unsave === true ? "/api/unsave" : "/api/save", { method: "POST", form: { id } }));
      return { status: a.unsave === true ? "unsaved" : "saved", id };
    } },
  { name: "reddit_subscribe", description: `Join or leave a subreddit with the user's account. ${PUBLIC}`,
    inputSchema: obj({ subreddit: { type: "string" }, leave: { type: "boolean" } }, ["subreddit"]),
    async handler(ctx, a) {
      const sr = subName(a.subreddit);
      await guard(ctx, "subscribe", { name: sr });
      checked(await rfetch(ctx, "/api/subscribe", { method: "POST", form: { action: a.leave === true ? "unsub" : "sub", sr_name: sr } }));
      return { status: a.leave === true ? "left" : "joined", subreddit: `r/${sr}` };
    } },
  { name: "reddit_send_message", description: `Send a private message from the user's Reddit account to another user. ${PUBLIC}`,
    inputSchema: obj({ to: { type: "string", description: "Username, e.g. u/someone" }, subject: { type: "string", description: "Up to 100 characters" }, text: { type: "string", description: "Markdown, up to 10000 characters" } }, ["to", "subject", "text"]),
    async handler(ctx, a) {
      const to = str(a.to, 30).replace(/^\/?u(ser)?\//i, "");
      if (!USER.test(to)) throw new PluginError("INVALID_ARGS", "to must be a Reddit username such as u/someone.");
      const subject = text(a.subject, 100, "subject"), body = text(a.text, 10_000);
      await guard(ctx, "privatemessages", null);
      checked(await rfetch(ctx, "/api/compose", { method: "POST", form: { to, subject, text: body } }));
      return { status: "sent", to: `u/${to}` };
    } },
  { name: "reddit_mark_read", description: "Mark inbox items (t4_ messages or t1_ comment replies from reddit_inbox) as read.",
    inputSchema: obj({ ids: { type: "array", items: { type: "string" }, description: "1-25 fullnames" } }, ["ids"]),
    async handler(ctx, a) {
      const ids = (Array.isArray(a.ids) ? a.ids : []).map((v) => fullname(v, ["t1", "t4"], "ids"));
      if (!ids.length || ids.length > 25) throw new PluginError("INVALID_ARGS", "ids must list 1 to 25 inbox items.");
      await guard(ctx, "privatemessages", null);
      checked(await rfetch(ctx, "/api/read_message", { method: "POST", form: { id: ids.join(",") } }));
      return { status: "marked_read", count: ids.length };
    } },
];

