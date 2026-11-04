import { queryOptions } from "@tanstack/react-query";

import { ENV } from "../../env";
import { call, type OutputStyleKey } from "../chat/chat-client";
import { STATIC } from "@/lib/query-policy";

export type StyleScope = "private" | "installation";
export type BuiltinStyle = {
  key: Exclude<OutputStyleKey, "custom">;
  name: string;
  description: string;
  body: string;
};
export type OutputStyle = {
  id: string;
  name: string;
  description: string;
  body: string;
  scope: StyleScope;
  version: number;
  /** True for a style the signed-in user owns. */
  mine: boolean;
  ownerName: string;
  updatedAt: string;
};
export type StyleDraft = { name: string; description: string; body: string };

/** Built-in names are their keys with a capital; a custom style is named by its row, which a draft does not carry. */
export const styleLabel = (key: OutputStyleKey) =>
  key === "custom" ? "Custom style" : key.charAt(0).toUpperCase() + key.slice(1);

export const outputStylesApi = {
  list: () => call<{ builtins: BuiltinStyle[]; styles: OutputStyle[] }>("/api/output-styles"),
  create: (v: StyleDraft & { scope?: StyleScope }) =>
    call<{ style: OutputStyle }>("/api/output-styles", "POST", v).then((r) => r.style),
  update: (id: string, expectedVersion: number, v: Partial<StyleDraft> & { scope?: StyleScope }) =>
    call<{ style: OutputStyle }>(`/api/output-styles/${id}`, "PATCH", {
      expectedVersion,
      ...v,
    }).then((r) => r.style),
  archive: (id: string) => call(`/api/output-styles/${id}`, "DELETE"),
  /** Creates a private style from a Claude Code style file. */
  importFile: (markdown: string) =>
    call<{ style: OutputStyle }>("/api/output-styles/import", "POST", { markdown }).then(
      (r) => r.style,
    ),
};

/** One key for the list: after a write to a style, invalidate `["output-styles"]`. */
export const outputStylesQueries = {
  list: () =>
    queryOptions({ queryKey: ["output-styles"], queryFn: () => outputStylesApi.list(), ...STATIC }),
};

/** The file itself: the server answers with an attachment, so a plain link downloads it. */
export const exportUrl = (target: { id: string } | { builtin: string }) =>
  new URL(
    "builtin" in target
      ? `/api/output-styles/builtin/${target.builtin}/export`
      : `/api/output-styles/${target.id}/export`,
    ENV.VITE_SERVER_URL,
  ).href;
