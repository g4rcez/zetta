import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";

/** What the server sends for Apps (apps/server/src/modules/apps/service.ts). */
export type AppVisibility = "private" | "team";
export type ToolKind = "query" | "mutation";
export type ToolPolicy = "ask" | "auto" | "block";
export type AppSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: AppVisibility;
  ownerUserId: string;
  sourcePlaygroundId: string | null;
  /** The active version number; null before the first publish. */
  version: number | null;
  tools: number;
  accounts: string[];
  updatedAt: string;
  /** The page of the app, when it has one. */
  ui: { entry: string; bytes: number } | null;
};
export type ToolManifest = {
  name: string;
  kind: ToolKind;
  description: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  approval?: unknown;
  accounts: string[];
  storage?: { collections: string[]; shared: string[]; write: boolean };
};
export type AppVersion = {
  id: string;
  n: number;
  note: string;
  createdAt: string;
  publishedByBotId: string | null;
  active: boolean;
  tools: number;
};
export type AppDetail = AppSummary & {
  isOwner: boolean;
  settings: { toolPolicy?: Record<string, ToolPolicy>; runner?: "host" | "container" };
  versions: AppVersion[];
  manifest: {
    tools: ToolManifest[];
    accounts: Record<string, { label: string; scope: "user" | "app" }>;
    ui?: { entry: string; bytes: number };
  } | null;
  /** One line per tool: how it is guarded, with the owner's choice counted. */
  policies: Record<string, string>;
};
export type ToolHit = {
  path: string;
  app: string;
  tool: string;
  kind: ToolKind;
  description: string;
  policy: string;
  needsAccounts: string[];
};
export type CallStatus = "pending_approval" | "running" | "ok" | "failed" | "denied" | "expired";
export type AppCallRow = {
  id: string;
  tool: string;
  kind: ToolKind;
  source: "bot" | "routine" | "workflow" | "mcp" | "ui" | "code";
  status: CallStatus;
  error: string | null;
  durationMs: number | null;
  botId: string | null;
  actorUserId: string;
  createdAt: string;
  finishedAt: string | null;
};
/** What an app keeps, for its Data tab. `otherRecords` is only for the owner: how many records other people hold (never their content). */
export type AppData = {
  app: string;
  collections: {
    name: string;
    kind: "personal" | "shared";
    records: number;
    bytes: number;
    otherRecords?: number;
  }[];
};
/** The page of an app, with the only tools its frame may call. */
export type AppPage = {
  app: string;
  name: string;
  version: number;
  html: string;
  tools: { name: string; kind: ToolKind; description: string }[];
};
/** What a call came back with (apps/server/src/modules/apps/service.ts `CallResult`). */
export type CallResult =
  | { status: "ok"; callId: string; value: unknown; durationMs: number }
  | {
      status: "failed";
      callId: string;
      error: { code: string; message: string };
      durationMs: number;
    }
  | { status: "denied"; callId: string; reason: string }
  | {
      status: "approval_required";
      callId: string;
      app: string;
      tool: string;
      kind: ToolKind;
      input: unknown;
      reason: string;
    };
export type ManifestChanges = {
  added: string[];
  removed: string[];
  changed: { name: string; what: string[] }[];
  accountsAdded: string[];
  accountsRemoved: string[];
};
export type Published = {
  app: { id: string; slug: string; name: string };
  version: { id: string; n: number };
  created: boolean;
  changes: ManifestChanges;
};

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};
const enc = encodeURIComponent;

export const appsApi = {
  list: () => call<{ apps: AppSummary[] }>("/api/apps").then((r) => r.apps),
  get: (ref: string) => call<{ app: AppDetail }>(`/api/apps/${enc(ref)}`).then((r) => r.app),
  tools: (o: { q?: string | undefined; app?: string | undefined }) =>
    call<{ tools: ToolHit[] }>(`/api/apps/tools${qs(o)}`).then((r) => r.tools),
  publish: (body: { playgroundId: string; name?: string; slug?: string; note?: string }) =>
    call<{ published: Published }>("/api/apps/publish", "POST", body).then((r) => r.published),
  update: (
    ref: string,
    patch: { name?: string; description?: string; visibility?: AppVisibility },
  ) => call<{ app: AppDetail }>(`/api/apps/${enc(ref)}`, "PATCH", patch).then((r) => r.app),
  archive: (ref: string) => call(`/api/apps/${enc(ref)}`, "DELETE"),
  rollback: (ref: string, n: number) =>
    call<{ app: AppDetail }>(`/api/apps/${enc(ref)}/rollback`, "POST", { n }).then((r) => r.app),
  setPolicy: (ref: string, tool: string, policy: ToolPolicy | null) =>
    call<{ app: AppDetail }>(`/api/apps/${enc(ref)}/tools/${enc(tool)}/policy`, "PUT", {
      policy,
    }).then((r) => r.app),
  calls: (ref: string) =>
    call<{ calls: AppCallRow[] }>(`/api/apps/${enc(ref)}/calls`).then((r) => r.calls),
  data: (ref: string) => call<{ data: AppData }>(`/api/apps/${enc(ref)}/data`).then((r) => r.data),
  /** `mine`: the caller's own records. `all` (owner only): every record of every person. */
  clearData: (ref: string, scope: "mine" | "all") =>
    call<{ removed: number }>(`/api/apps/${enc(ref)}/data?scope=${scope}`, "DELETE"),
  ui: (ref: string) => call<{ page: AppPage }>(`/api/apps/${enc(ref)}/ui`).then((r) => r.page),
  /** Calls a tool as the person (the page of an app does it through the host, never itself). */
  call: (ref: string, tool: string, input: Record<string, unknown>) =>
    call<{ result: CallResult }>(`/api/apps/${enc(ref)}/call`, "POST", { tool, input }).then(
      (r) => r.result,
    ),
  answer: (callId: string, action: "accept" | "decline" | "cancel") =>
    call<{ result: CallResult }>(`/api/app-calls/${enc(callId)}/answer`, "POST", { action }).then(
      (r) => r.result,
    ),
  bots: (ref: string) =>
    call<{ botIds: string[] }>(`/api/apps/${enc(ref)}/bots`).then((r) => r.botIds),
  setBots: (ref: string, botIds: string[]) =>
    call<{ botIds: string[] }>(`/api/apps/${enc(ref)}/bots`, "PUT", { botIds }).then(
      (r) => r.botIds,
    ),
};

/** Every key starts with "apps", so one live event (`apps`) refreshes whatever is on screen. */
export const appsQueries = {
  list: () => queryOptions({ queryKey: ["apps", "list"], queryFn: appsApi.list }),
  detail: (ref: string) =>
    queryOptions({ queryKey: ["apps", "detail", ref], queryFn: () => appsApi.get(ref) }),
  tools: (q: string, app: string) =>
    queryOptions({
      queryKey: ["apps", "tools", q, app],
      queryFn: () => appsApi.tools({ q: q || undefined, app: app || undefined }),
    }),
  calls: (ref: string) =>
    queryOptions({ queryKey: ["apps", "calls", ref], queryFn: () => appsApi.calls(ref) }),
  data: (ref: string) =>
    queryOptions({ queryKey: ["apps", "data", ref], queryFn: () => appsApi.data(ref) }),
  /** The page of an app version never changes, so it is not refetched on focus; a new publish changes the key through the live `apps` event. */
  ui: (ref: string) =>
    queryOptions({
      queryKey: ["apps", "ui", ref],
      queryFn: () => appsApi.ui(ref),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    }),
  bots: (ref: string) =>
    queryOptions({ queryKey: ["apps", "bots", ref], queryFn: () => appsApi.bots(ref) }),
};
