import { Database, Download, NotebookText, RotateCcw, Settings2, SquareCheckBig } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { ToggleCard } from "../plugins/toggle-card";
import { Empty, Modal } from "../shared/ui";
import { cell, columnLabel, databaseApi, size, tableLabel, type DbOverview, type DbPage, type DbTable, type DbTemplate } from "./database-api";

const TEMPLATE_ICON: Record<string, typeof Database> = { tasks: SquareCheckBig, preferences: Settings2, notes: NotebookText };
const PAGE = 25;

/**
 * Bot settings > Database. What the bot keeps in its private database, in plain words: each table shows the bot's own description,
 * people can browse it, download it, add a ready-made table, switch the database off for the bot, or erase everything and start over.
 */
export function DatabaseSection({ bot, notify }: { bot: Bot; notify: (m: string) => void }) {
  const [data, setData] = useState<DbOverview>();
  const [templates, setTemplates] = useState<DbTemplate[]>([]);
  const [error, setError] = useState<{ message: string; fix?: string }>();
  const [busy, setBusy] = useState<string>();
  const [open, setOpen] = useState<DbTable>();
  const [resetting, setResetting] = useState(false);
  const fail = (e: unknown) => setError({ message: errorMessage(e), fix: (e as { details?: { fix?: unknown } }).details?.fix as string | undefined });

  const reload = useCallback(async () => {
    try { setError(undefined); setData(await databaseApi.overview(bot.id)); } catch (e) { fail(e); }
  }, [bot.id]);
  useEffect(() => { setData(undefined); void reload(); void databaseApi.templates().then(setTemplates).catch(() => {}); }, [reload]);

  async function run(key: string, work: () => Promise<unknown>, done?: string) {
    setBusy(key); setError(undefined);
    try { await work(); if (done) notify(done); await reload(); } catch (e) { fail(e); } finally { setBusy(undefined); }
  }

  const used = data ? Math.min(100, Math.round((data.usedBytes / data.quotaBytes) * 100)) : 0;
  return (
    <section aria-label="Database" className="space-y-4 text-sm">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-medium"><Database aria-hidden className="size-4" /> {bot.name}'s database</h3>
        <p className="text-xs text-muted-foreground">
          A private place where {bot.name} keeps what it needs between conversations: to-do lists, your preferences, notes, options for its job.
          Just ask it in the chat, for example "keep track of my tasks". It sets everything up by itself, and only {bot.name} can read or change it.
        </p>
        {data && <p className="text-xs text-muted-foreground">Bot id <code className="rounded bg-muted px-1">{data.slug}</code> · stored as <code className="rounded bg-muted px-1">{data.schema}</code></p>}
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p>{error.message}</p>{error.fix && <p className="mt-1 text-foreground">What you can do: {error.fix}</p>}
        </div>
      )}
      {!data && !error && <Empty>Loading...</Empty>}

      {data && (<>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Space used</span><span>{size(data.usedBytes)} of {size(data.quotaBytes)}</span></div>
          <div role="meter" aria-label="Space used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${used >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.max(used, data.usedBytes ? 2 : 0)}%` }} />
          </div>
        </div>

        <ToggleCard leading={<Database aria-hidden className="size-6" />} title={`Let ${bot.name} use its database`}
          description={data.access ? "On: it can save and look things up." : "Off: it cannot read or save anything. What it saved is kept."}
          label={`${bot.name} can use its database`} checked={data.access} disabled={busy === "access"}
          onChange={(on) => void run("access", () => databaseApi.setAccess(bot.id, on))} />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium">What {bot.name} saved</h4>
            {data.tables.length > 0 && <Button size="sm" variant="outline" loading={busy === "export"} onClick={() => void run("export", () => databaseApi.download(bot.id, "all"))}><Download aria-hidden className="size-3.5" /> Download everything</Button>}
          </div>
          {data.tables.length === 0 ? <Empty>Nothing saved yet. Ask {bot.name} to keep track of something, or start from a ready-made table below.</Empty> : (
            <ul className="space-y-2">{data.tables.map((t) => { const l = tableLabel(t); return (
              <li key={t.name}>
                <button type="button" onClick={() => setOpen(t)} className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.title}</span>
                    {l.detail && <span className="line-clamp-2 block text-xs text-muted-foreground">{l.detail}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t.rows === 1 ? "1 entry" : `${t.rows} entries`}</span>
                </button>
              </li>); })}</ul>
          )}
        </div>

        {templates.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium">Ready-made tables</h4>
            <p className="text-xs text-muted-foreground">Add one with a click; {bot.name} will use it when it fits what you ask.</p>
            <ul className="grid gap-2 sm:grid-cols-3">{templates.map((t) => { const Icon = TEMPLATE_ICON[t.id] ?? Database; const added = data.templates.includes(t.id); return (
              <li key={t.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                <span className="flex items-center gap-2 font-medium"><Icon aria-hidden className="size-4 text-muted-foreground" /> {t.title}</span>
                <span className="flex-1 text-xs text-muted-foreground">{t.description}</span>
                <Button size="sm" variant="outline" disabled={added || !!busy} loading={busy === `t:${t.id}`} onClick={() => void run(`t:${t.id}`, () => databaseApi.applyTemplate(bot.id, t.id), `${t.title} added to ${bot.name}'s database.`)}>{added ? "Added" : "Add"}</Button>
              </li>); })}</ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3">
          <span className="min-w-0"><span className="block font-medium">Start over</span><span className="text-xs text-muted-foreground">Erase everything {bot.name} saved. This cannot be undone.</span></span>
          <Button size="sm" variant="destructive" onClick={() => setResetting(true)}><RotateCcw aria-hidden className="size-3.5" /> Start over</Button>
        </div>
      </>)}

      {open && <TableViewer botId={bot.id} table={open} onClose={() => setOpen(undefined)} />}
      {resetting && data && <ResetDialog bot={bot} slug={data.slug} onClose={() => setResetting(false)} onDone={() => { notify(`${bot.name}'s database is empty again.`); void reload(); }} />}
    </section>
  );
}

function TableViewer({ botId, table, onClose }: { botId: string; table: DbTable; onClose: () => void }) {
  const [page, setPage] = useState<DbPage>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true; setError(undefined);
    databaseApi.rows(botId, table.name, offset, PAGE).then((p) => { if (live) setPage(p); }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [botId, table.name, offset]);
  const l = tableLabel(table); const cols = (page?.table ?? table).columns; const total = page?.total ?? table.rows;
  return (
    <Modal title={l.title} onClose={onClose}>
      {l.detail && <p className="text-muted-foreground">{l.detail}</p>}
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {!page && !error && <Empty>Loading...</Empty>}
      {page && (page.rows.length === 0 ? <Empty>No entries yet.</Empty> : (
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted"><tr>{cols.map((c) => <th key={c.name} scope="col" title={c.name} className="whitespace-nowrap px-2 py-1.5 font-medium">{columnLabel(c)}</th>)}</tr></thead>
            <tbody>{page.rows.map((r, i) => (
              <tr key={i} className="border-t align-top">{cols.map((c) => { const v = cell(r[c.name]); return <td key={c.name} title={v.length > 80 ? v : undefined} className="max-w-64 truncate px-2 py-1.5">{v}</td>; })}</tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{total === 0 ? "" : `${offset + 1}-${Math.min(offset + PAGE, total)} of ${total}`}</span>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
          <Button size="sm" variant="outline" loading={saving} disabled={total === 0} onClick={() => { setSaving(true); databaseApi.download(botId, { table: table.name }).catch((e) => setError(errorMessage(e))).finally(() => setSaving(false)); }}><Download aria-hidden className="size-3.5" /> CSV</Button>
        </span>
      </div>
    </Modal>
  );
}

function ResetDialog({ bot, slug, onClose, onDone }: { bot: Bot; slug: string; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(undefined);
    try { await databaseApi.reset(bot.id, typed); onDone(); onClose(); } catch (x) { setError(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Erase ${bot.name}'s database?`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label="Start over">
        <p>Everything {bot.name} saved (tables, lists, preferences, notes) is deleted for good. {bot.name} keeps working and starts again from an empty database.</p>
        <p className="text-muted-foreground">Want a copy first? Close this and use Download everything.</p>
        <Input title={`Type ${slug} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={slug} />
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="destructive" size="sm" loading={busy} disabled={busy || typed.trim() !== slug}>Erase everything</Button>
        </div>
      </form>
    </Modal>
  );
}
