import { queryOptions } from "@tanstack/react-query";

import type { BotAvatarValue } from "../chat/chat-client";
import { call } from "../chat/chat-client";

/** A bot in the Grok Bot marketplace catalog. The catalog leaves out what a bot holds; that comes with the preview. */
export type GrokListItem = {
  id: string;
  name: string;
  creatorName: string;
  handle: string | null;
  summary: string;
  categories: string[];
  color: string;
  shape: string;
  imageUrl: string | null;
  /** A preset picture in the bot's marketplace color and shape. The creator's own image is never loaded from outside here. */
  avatar: BotAvatarValue;
};

/** What a person sees of one marketplace bot before choosing to import it. */
export type GrokPreview = {
  id: string;
  url: string;
  name: string;
  creatorName: string;
  handle: string | null;
  description: string;
  categories: string[];
  avatar: BotAvatarValue;
  memories: string[];
  skills: { name: string; description: string }[];
  routines: { name: string; text: string; schedule: string }[];
  integrations: { name: string; description: string; pluginId: string | null }[];
};

export type ScheduleDraft =
  | { kind: "daily"; dailyAt: string; weekdays: number[] | null }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "unsupported"; expression: string | null };

/** What an import will create, written out so it can be read and edited first. The server checks it again on install. */
export type BotImportDraft = {
  source: { url: string; slug: string; creator: string; handle: string | null };
  name: string;
  description: string;
  avatar: BotAvatarValue;
  personality: string;
  instructions: string;
  timezone: string;
  skills: {
    sourceId: string;
    name: string;
    description: string;
    body: string;
    warnings: string[];
  }[];
  notes: { sourceId: string; content: string; warnings: string[] }[];
  routines: {
    sourceId: string;
    title: string;
    prompt: string;
    schedule: ScheduleDraft;
    state: "active" | "paused";
    note: string | null;
  }[];
  integrations: { name: string; description: string; pluginId: string | null }[];
  warnings: string[];
};

export type InstallResult = {
  bot: { id: string; name: string; slug: string };
  skills: { id: string; name: string }[];
  notes: number;
  routines: { id: string; title: string; state: "active" | "paused"; reason: string | null }[];
  integrations: BotImportDraft["integrations"];
  warnings: string[];
};

const FIVE_MINUTES = 5 * 60_000;

export const grokQueries = {
  list: () =>
    queryOptions({
      queryKey: ["bot-import", "grok", "list"],
      queryFn: () => call<{ bots: GrokListItem[] }>("/api/bot-import/grok").then((r) => r.bots),
      staleTime: FIVE_MINUTES,
    }),
  preview: (id: string) =>
    queryOptions({
      queryKey: ["bot-import", "grok", "preview", id],
      queryFn: () =>
        call<{ bot: GrokPreview }>(`/api/bot-import/grok/${encodeURIComponent(id)}`).then(
          (r) => r.bot,
        ),
      staleTime: FIVE_MINUTES,
    }),
};

export const grokApi = {
  /** Has the person's Chief write what the marketplace does not show. Creates nothing. Can take a couple of minutes. */
  analyze: (source: string, timezone: string) =>
    call<{ draft: BotImportDraft }>("/api/bot-import/grok/analyze", "POST", {
      source,
      timezone,
    }).then((r) => r.draft),
  install: (draft: BotImportDraft) =>
    call<{ result: InstallResult }>("/api/bot-import/install", "POST", { draft }).then(
      (r) => r.result,
    ),
};

/** The person's own timezone, which the imported routines' times are read in. */
export const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** A marketplace bot's address, or the id of one: what the analyze call takes. Null when it is neither. */
export function marketplaceSource(input: string): string | null {
  const v = input.trim();
  if (/^[a-z0-9][a-z0-9_-]{0,80}$/.test(v)) return v;
  try {
    const u = new URL(v);
    const ok =
      u.protocol === "https:" &&
      (u.hostname === "x.ai" || u.hostname === "www.x.ai") &&
      /^\/bot\/marketplace\/bots\/[a-z0-9][a-z0-9_-]{0,80}\/?$/.test(u.pathname);
    return ok ? v : null;
  } catch {
    return null;
  }
}
