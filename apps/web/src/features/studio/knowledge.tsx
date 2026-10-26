import { Sources } from "./sources";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

import { ApiError, call, errorMessage } from "../chat/chat-client";
import { ConfirmButton, Empty, field, Field, useList } from "../shared/ui";

type Memory = { id: string; content: string; category: "fact" | "preference" | "decision" | "correction"; version: number };
type Instruction = { id: string; title: string; body: string; trigger?: string; verification?: string; version: number };
const CATEGORY = { fact: "Fact", preference: "Preference", decision: "Decision", correction: "Correction" } as const;

/** Maps the knowledge API errors to plain sentences. */
export function knowledgeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "SECRET_REJECTED") return "That looks like a password or key, so it was not saved. Remove the secret and try again.";
    if (e.code === "LIMIT") return "Limit reached. Delete something you no longer need first.";
    if (e.code === "STALE_VERSION") return "This changed somewhere else (or is a duplicate). The list was reloaded; try again.";
  }
  return errorMessage(e);
}

function MemorySection({ onError }: { onError: (m: string) => void }) {
  const [rows, reload] = useList<Memory>("/api/memories", "memories", onError);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const run = async (work: () => Promise<unknown>, done: string) => { setError(undefined); setStatus(undefined); try { await work(); setStatus(done); } catch (e) { setError(knowledgeError(e)); } await reload(); };
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, f = new FormData(form);
    await run(async () => { await call("/api/memories", "POST", { content: String(f.get("content")).trim(), category: f.get("category") }); form.reset(); }, "Saved.");
  }
  async function save(m: Memory, e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const content = String(new FormData(e.currentTarget).get("content")).trim();
    await run(async () => { await call(`/api/memories/${m.id}`, "PATCH", { expectedVersion: m.version, content }); setEditing(undefined); }, "Updated.");
  }
  return (
    <section aria-label="Memory" className="min-w-0 space-y-3 rounded-lg border bg-card p-5"><h2 className="font-medium">What bots remember about you {rows && <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>}</h2>
      <p className="text-xs text-muted-foreground">Tip: in any chat, start a message with "remember that…". Never save passwords or keys here.</p>
      <form onSubmit={(e) => void add(e)} className="flex flex-wrap gap-2">
        <input name="content" required maxLength={500} aria-label="New memory" className={`${field} flex-1`} />
        <select name="category" aria-label="Kind of memory" className={`${field} w-36`}>{Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <Button size="sm" type="submit">Add</Button>
      </form>
      <p role="status" className="text-xs empty:hidden">{status}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows?.length === 0 && <Empty>Nothing remembered yet.</Empty>}
      <ul className="space-y-1">{rows?.map((m) => (
        <li key={m.id} className="min-w-0 rounded-md border bg-card p-3 text-sm">
          {editing === m.id ? (
            <form onSubmit={(e) => void save(m, e)} className="flex flex-wrap gap-2"><input name="content" defaultValue={m.content} required maxLength={500} aria-label="Edit memory" className={`${field} flex-1`} /><Button size="sm" type="submit">Save</Button><Button size="sm" type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button></form>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 break-words"><span className="mr-1 rounded-lg border px-2 text-xs">{CATEGORY[m.category] ?? m.category}</span>{m.content}</span>
              <span className="flex gap-1"><Button size="xs" variant="outline" onClick={() => setEditing(m.id)}>Edit<span className="sr-only"> memory</span></Button><ConfirmButton size="xs" label="Forget" question="Forget this?" confirmLabel="Forget" onConfirm={() => run(() => call(`/api/memories/${m.id}`, "DELETE"), "Forgotten.")} /></span></div>)}
        </li>))}</ul></section>
  );
}

function InstructionSection({ onError }: { onError: (m: string) => void }) {
  const [rows, reload] = useList<Instruction>("/api/instructions", "instructions", onError);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const run = async (work: () => Promise<unknown>, done: string) => { setError(undefined); setStatus(undefined); try { await work(); setStatus(done); } catch (e) { setError(knowledgeError(e)); } await reload(); };
  const body = (f: FormData) => ({ title: String(f.get("title")).trim(), body: String(f.get("body")).trim(), trigger: String(f.get("trigger") ?? "").trim(), verification: String(f.get("verification") ?? "").trim() });
  const fields = (i?: Instruction) => (<>
    <Field label="Title"><input name="title" required maxLength={120} defaultValue={i?.title} placeholder="e.g. weekly newsletter" className={field} /></Field>
    <Field label="Steps to follow"><textarea name="body" required rows={3} maxLength={8000} defaultValue={i?.body} className={field} /></Field>
    <Field label="When to use it (optional)"><input name="trigger" maxLength={300} defaultValue={i?.trigger} className={field} /></Field>
    <Field label="How to check it worked (optional)"><input name="verification" maxLength={500} defaultValue={i?.verification} className={field} /></Field></>);
  return (
    <section aria-label="Instruction library" className="min-w-0 space-y-3 rounded-lg border bg-card p-5"><h2 className="font-medium">Reusable instructions {rows && <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>}</h2>
      <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; void run(async () => { await call("/api/instructions", "POST", body(new FormData(form))); form.reset(); }, "Saved."); }} className="space-y-2">{fields()}<Button size="sm" type="submit">Save instruction</Button></form>
      <p role="status" className="text-xs empty:hidden">{status}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows?.length === 0 && <Empty>No instructions yet.</Empty>}
      <ul className="space-y-1">{rows?.map((m) => (
        <li key={m.id} className="min-w-0 rounded-md border bg-card p-3 text-sm">
          {editing === m.id ? (
            <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await call(`/api/instructions/${m.id}`, "PATCH", { expectedVersion: m.version, ...body(new FormData(e.currentTarget)) }); setEditing(undefined); }, "Updated."); }} className="space-y-2">{fields(m)}<div className="flex gap-2"><Button size="sm" type="submit">Save</Button><Button size="sm" type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button></div></form>
          ) : (<>
            <p className="font-medium">{m.title}</p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            {m.trigger && <p className="break-words text-xs text-muted-foreground">Use when: {m.trigger}</p>}
            {m.verification && <p className="break-words text-xs text-muted-foreground">Check: {m.verification}</p>}
            <div className="mt-1 flex gap-1"><Button size="xs" variant="outline" onClick={() => setEditing(m.id)}>Edit<span className="sr-only"> {m.title}</span></Button>
              <ConfirmButton size="xs" label="Archive" question="Archive this instruction?" confirmLabel="Archive" onConfirm={() => run(() => call(`/api/instructions/${m.id}`, "PATCH", { expectedVersion: m.version, archived: true }), "Archived.")} /></div></>)}
        </li>))}</ul></section>
  );
}

export function Knowledge({ onError }: { onError: (m: string) => void }) {
  return <div className="space-y-6"><div className="grid gap-6 md:grid-cols-2"><MemorySection onError={onError} /><InstructionSection onError={onError} /></div><Sources onError={onError} /></div>;
}
