import { ENV } from "../../env";
import { call, toApiError } from "../chat/chat-client";

export type DbColumn = { name: string; type: string; description: string | null; nullable: boolean };
export type DbTable = { name: string; description: string | null; columns: DbColumn[]; rows: number; bytes: number };
export type DbOverview = { schema: string; slug: string; access: boolean; templates: string[]; usedBytes: number; quotaBytes: number; tables: DbTable[] };
export type DbTemplate = { id: string; title: string; description: string };
export type DbPage = { table: DbTable; rows: Record<string, unknown>[]; offset: number; total: number };

const base = (botId: string) => `/api/bots/${botId}/database`;
export const databaseApi = {
  overview: (botId: string) => call<{ database: DbOverview }>(base(botId)).then((r) => r.database),
  templates: () => call<{ templates: DbTemplate[] }>("/api/bot-database/templates").then((r) => r.templates),
  rows: (botId: string, table: string, offset: number, limit: number) => call<DbPage>(`${base(botId)}/tables/${encodeURIComponent(table)}?offset=${offset}&limit=${limit}`),
  applyTemplate: (botId: string, id: string) => call(`${base(botId)}/templates/${id}`, "POST", {}),
  reset: (botId: string, confirm: string) => call(`${base(botId)}/reset`, "POST", { confirm }),
  setAccess: (botId: string, enabled: boolean) => call<{ access: boolean }>(`${base(botId)}/access`, "PUT", { enabled }),
  /** Saves a server download (JSON of everything, or one table as CSV) through a temporary link. */
  async download(botId: string, what: { table: string } | "all") {
    const path = what === "all" ? `${base(botId)}/export.json` : `${base(botId)}/tables/${encodeURIComponent(what.table)}/export.csv`;
    const res = await fetch(new URL(path, ENV.VITE_SERVER_URL), { credentials: "include", cache: "no-store" });
    if (!res.ok) throw await toApiError(res);
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "database";
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name }); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** "due_at" -> "Due at": what people see when the bot did not describe a column. */
export const humanize = (name: string) => capital(name.replace(/[_-]+/g, " ").trim()) || name;
/** A table's comment is "Title: longer description" (the bot is asked to write it that way); either half may be missing. */
export function tableLabel(t: DbTable) {
  const d = t.description?.trim();
  if (!d) return { title: humanize(t.name), detail: "" };
  const i = d.indexOf(":");
  return i > 0 && i < 60 ? { title: d.slice(0, i).trim(), detail: capital(d.slice(i + 1).trim()) } : { title: d.length <= 60 ? d : humanize(t.name), detail: d.length <= 60 ? "" : d };
}
export const columnLabel = (c: DbColumn) => c.description?.trim() || humanize(c.name);
export const size = (bytes: number) => { const mb = bytes / 1048576; return bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`; };
/** One cell as readable text. */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) { const d = new Date(v); if (!Number.isNaN(d.getTime())) return d.toLocaleString(); }
  if (Array.isArray(v)) return v.map(cell).join(", ");
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
