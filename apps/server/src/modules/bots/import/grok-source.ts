import { z } from "zod";

import { assertPublicUrl } from "../../computer/service";
import { presetFor } from "./avatar";
import { ImportError } from "./errors";

/**
 * Reads bots from the Grok Bot marketplace (https://x.ai/bot/marketplace). The site has no API, but its pages are Next.js: the page
 * streams its data as `self.__next_f.push([1,"..."])` chunks, and the bot objects (name, memories, skills, routines, integrations) are
 * plain JSON inside them. A detail page holds one bot, the index page holds all of them.
 *
 * This reads a third party's page, so nothing here guesses: an object that does not match the schema is skipped, and a page with no
 * bot at all is `PAGE_CHANGED` (the site changed and this reader needs an update) rather than an empty answer.
 */

const HOSTS = new Set(["x.ai", "www.x.ai"]);
const INDEX_URL = "https://x.ai/bot/marketplace";
const botUrl = (slug: string) => `https://x.ai/bot/marketplace/bots/${slug}`;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,80}$/;
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;
/** The index changes a few times a day at most; a catalog read once per 10 minutes is plenty. */
const LIST_TTL_MS = 10 * 60_000;

/** The id of a bot from what a person pasted: a bare id, or the bot's page on x.ai. Anything else is refused before a request is made. */
export function parseGrokUrl(input: string): string {
  const value = input.trim();
  if (SLUG.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ImportError("BAD_URL", "That is not a Grok Bot marketplace bot link.");
  }
  const path = /^\/bot\/marketplace\/bots\/([a-z0-9][a-z0-9_-]{0,80})\/?$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !HOSTS.has(url.hostname) ||
    !path
  )
    throw new ImportError(
      "BAD_URL",
      "That is not a Grok Bot marketplace bot link. It should look like https://x.ai/bot/marketplace/bots/<name>.",
    );
  return path[1]!;
}

// Long texts are cut, never rejected: a bot with one very long memory should still import, just shorter.
const cut = (max: number) => (s: string | null | undefined) => (s ?? "").slice(0, max);
const opt = (max: number) => z.string().nullish().transform(cut(max));
const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .nullish()
    .transform((items) => (items ?? []).slice(0, max));

const memory = z.object({ id: opt(80), name: opt(200), description: opt(4000) });
const skill = z.object({
  id: opt(80),
  name: z.string().min(1).transform(cut(200)),
  description: opt(2000),
  /** All the marketplace shows of a skill: the "use this when..." line. The full playbook is not public. */
  content: opt(20_000),
});
const routine = z.object({
  id: opt(80),
  name: z.string().min(1).transform(cut(200)),
  /** Holds the schedule as a cron expression ("Cron 44 8 * * 1-5 (...)") and a line on what the routine does. */
  summary: opt(4000),
});
const integration = z.object({
  id: opt(80),
  name: z.string().min(1).transform(cut(200)),
  description: opt(2000),
});

export const grokBotSchema = z.object({
  id: z.string().regex(SLUG),
  name: z.string().min(1).transform(cut(200)),
  creatorName: opt(200),
  handle: z
    .string()
    .nullish()
    .transform((s) => (s ? s.slice(0, 100) : null)),
  description: opt(5000),
  summary: opt(2000),
  categories: list(z.string().transform(cut(80)), 10),
  installCount: z
    .number()
    .nullish()
    .transform((n) => n ?? 0),
  color: opt(40),
  shape: opt(40),
  addHref: z.string().min(1).transform(cut(300)),
  imageUrl: z
    .string()
    .nullish()
    .transform((s) => (s ? s.slice(0, 500) : null)),
  updatedAt: opt(40),
  instructions: opt(20_000),
  memories: list(memory, 100),
  skills: list(skill, 100),
  routines: list(routine, 100),
  integrations: list(integration, 100),
});
export type GrokBot = z.infer<typeof grokBotSchema>;

/**
 * What the catalog shows of a bot: enough to choose one. The index page lists every bot but leaves its memories, skills, routines and
 * integrations empty (only a bot's own page has them), so no counts here: they would read 0 for every bot.
 */
export type GrokListItem = Pick<
  GrokBot,
  | "id"
  | "name"
  | "creatorName"
  | "handle"
  | "summary"
  | "categories"
  | "color"
  | "shape"
  | "imageUrl"
> & {
  /** A preset picture in the bot's marketplace color and shape, so a screen never has to load the creator's image from outside. */
  avatar: ReturnType<typeof presetFor>;
};
const toItem = (b: GrokBot): GrokListItem => ({
  id: b.id,
  name: b.name,
  creatorName: b.creatorName,
  handle: b.handle,
  summary: b.summary || b.description.slice(0, 300),
  categories: b.categories,
  color: b.color,
  shape: b.shape,
  imageUrl: b.imageUrl,
  avatar: presetFor(b),
});

const CHUNK_START = "self.__next_f.push([1,";
/**
 * The page's streamed text: every `__next_f` chunk decoded and joined (an object may be split across two chunks). The string literal is
 * found by walking it, not with a regex: a pattern that takes one character per step runs out of backtracking room on a large page.
 */
function flightText(html: string): string {
  let out = "";
  for (let at = html.indexOf(CHUNK_START); at !== -1; at = html.indexOf(CHUNK_START, at + 1)) {
    const open = at + CHUNK_START.length;
    if (html.charCodeAt(open) !== 34) continue;
    let close = open + 1;
    while (close < html.length) {
      const c = html.charCodeAt(close);
      if (c === 92) close++; // backslash: the next character is escaped
      else if (c === 34) break;
      close++;
    }
    if (close >= html.length) continue; // never closed
    try {
      out += JSON.parse(html.slice(open, close + 1)) as string;
    } catch {
      // A chunk that does not decode is skipped; whatever is missing makes the bot fail validation below, not crash.
    }
  }
  return out;
}

/** The JSON object that starts at `start` (a `{`), found by counting braces outside strings; null when it never closes. */
function objectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: the next character is escaped
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Every bot in a page. Throws `PAGE_CHANGED` when there is none. */
export function parseGrokBots(html: string): GrokBot[] {
  const text = flightText(html);
  const found = new Map<string, GrokBot>();
  let consumed = 0;
  for (let at = text.indexOf('"addHref"'); at !== -1; at = text.indexOf('"addHref"', at + 1)) {
    // A bot object opens with its id, and nothing nested comes before `addHref`, so the last `{"id":"` before it is the start.
    const start = text.lastIndexOf('{"id":"', at);
    if (start < consumed) continue;
    const raw = objectAt(text, start);
    if (!raw) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = grokBotSchema.safeParse(json);
    if (!parsed.success) continue;
    consumed = start + raw.length;
    if (!found.has(parsed.data.id)) found.set(parsed.data.id, parsed.data);
  }
  if (found.size === 0)
    throw new ImportError(
      "PAGE_CHANGED",
      "The Grok Bot marketplace page has no bot data where it used to. The site probably changed, and the importer needs an update.",
    );
  return [...found.values()];
}

/** Gets a page's HTML. Throws `ImportError` (`FETCH_FAILED`, `NOT_FOUND`). Injected in tests. */
export type GrokFetch = (url: string) => Promise<string>;

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ImportError(
        "FETCH_FAILED",
        "The Grok Bot marketplace page is larger than expected.",
      );
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The real fetch: https to x.ai only (the address is checked before every request, redirects included, which may only go to x.ai too),
 * with a timeout and a size limit. The only thing sent is a generic client name.
 */
export const defaultGrokFetch: GrokFetch = async (url) => {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(target);
    if (u.protocol !== "https:" || !HOSTS.has(u.hostname))
      throw new ImportError(
        "FETCH_FAILED",
        "The Grok Bot marketplace sent us somewhere else, so we stopped.",
      );
    await assertPublicUrl(target).catch(() => {
      throw new ImportError("FETCH_FAILED", "The Grok Bot marketplace address was refused.");
    });
    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/html", "user-agent": "Zetta bot import" },
      });
    } catch {
      throw new ImportError("FETCH_FAILED", "Could not reach the Grok Bot marketplace.");
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location)
        throw new ImportError(
          "FETCH_FAILED",
          "The Grok Bot marketplace sent a redirect with nowhere to go.",
        );
      target = new URL(location, target).toString();
      continue;
    }
    if (res.status === 404)
      throw new ImportError("NOT_FOUND", "The Grok Bot marketplace has no bot with that name.");
    if (!res.ok)
      throw new ImportError("FETCH_FAILED", `The Grok Bot marketplace answered ${res.status}.`);
    return await readCapped(res);
  }
  throw new ImportError("FETCH_FAILED", "The Grok Bot marketplace redirected too many times.");
};

export type GrokSource = {
  /** The catalog: every bot, without the long text. Cached for 10 minutes. */
  list(): Promise<GrokListItem[]>;
  /** One bot with everything the marketplace shows. Takes a bare id or the bot's page URL. */
  get(idOrUrl: string): Promise<GrokBot>;
};

export function createGrokSource(deps: { fetch?: GrokFetch; now?: () => number } = {}): GrokSource {
  const get = deps.fetch ?? defaultGrokFetch;
  const now = deps.now ?? Date.now;
  let cached: { at: number; items: GrokListItem[] } | null = null;
  return {
    async list() {
      if (cached && now() - cached.at < LIST_TTL_MS) return cached.items;
      const items = parseGrokBots(await get(INDEX_URL)).map(toItem);
      cached = { at: now(), items };
      return items;
    },
    async get(idOrUrl) {
      const slug = parseGrokUrl(idOrUrl);
      const bots = parseGrokBots(await get(botUrl(slug)));
      // The page can also carry other bots (suggestions); take the one asked for. A page of exactly one bot is that bot (a renamed link).
      const hit = bots.find((b) => b.id === slug) ?? (bots.length === 1 ? bots[0] : undefined);
      if (!hit)
        throw new ImportError("NOT_FOUND", "The Grok Bot marketplace has no bot with that name.");
      return hit;
    },
  };
}
