import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";

export type SearchKind = "conversation" | "message" | "memory" | "artifact" | "task";
export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** Words that match the query are wrapped in `[[` and `]]`. */
  snippet: string;
  conversationId: string | null;
  messageId: string | null;
  updatedAt: string;
};

export const KIND_LABEL: Record<SearchKind, string> = {
  conversation: "Chat",
  message: "Message",
  memory: "Memory",
  artifact: "Artifact",
  task: "Task",
};

export const searchApi = {
  search: (q: string, limit = 20) =>
    call<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`).then(
      (r) => r.hits,
    ),
};

/** The snippet as plain text, without the match markers. */
export const plainSnippet = (s: string) => s.replace(/\[\[|\]\]/g, "");

/** Where a hit opens: a router path and its params, ready for `<Link>` or `navigate`. */
export function hitTarget(h: SearchHit): {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
} {
  switch (h.kind) {
    case "conversation":
    case "message":
      return h.conversationId
        ? { to: "/chat/{-$chatId}", params: { chatId: h.conversationId } }
        : { to: "/chat/{-$chatId}" };
    case "task":
      return { to: "/tasks" };
    case "artifact":
      return { to: "/artifacts/$artifactId", params: { artifactId: h.id } };
    case "memory":
      // The id of a memory hit is its slug.
      return { to: "/memory/$slug", params: { slug: h.id } };
  }
}

/** The key holds the submitted text and the limit: the same search from two places is one request. */
export const searchQueries = {
  hits: (q: string, limit = 20) =>
    queryOptions({ queryKey: ["search", q, limit], queryFn: () => searchApi.search(q, limit) }),
};
