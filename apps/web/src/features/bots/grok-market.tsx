import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { Button, Input } from "@/components/ui";
import { Alert } from "@g4rcez/components/alert";
import { errorMessage } from "../chat/chat-client";
import { Badge, Choice, Empty, Loading } from "../shared/ui";
import { grokQueries, marketplaceSource, type GrokListItem } from "./grok-api";
import { categoriesOf, filterCatalog } from "./grok-filter";

/**
 * The Grok Bot marketplace as a starting point for a new bot: a searchable catalog, a box for a bot's link, and beside it what the
 * chosen bot holds. Every filter and the pick come from the address (props), so Back and a shared link show the same view.
 */

function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
      {["", ...categories].map((c) => (
        <button
          key={c || "all"}
          type="button"
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring ${value === c ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:border-foreground/25"}`}
        >
          {c || "All"}
        </button>
      ))}
    </div>
  );
}

function PasteLink({ onOpen }: { onOpen: (id: string) => void }) {
  const [problem, setProblem] = useState<string>();
  // Read when the form is sent, so the box holds its own text and nothing here mirrors it.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("link") ?? "");
    const source = marketplaceSource(value);
    if (!source)
      return setProblem(
        value.trim()
          ? "That is not a Grok Bot marketplace bot link. It looks like https://x.ai/bot/marketplace/bots/<name>."
          : "Paste the bot's link first.",
      );
    setProblem(undefined);
    // The page's own id is the last part of its address; a bare id is already one.
    onOpen(source.replace(/\/+$/, "").split("/").pop()!);
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          title="Have a link to a bot?"
          name="link"
          container="min-w-64 flex-1"
          required={false}
          autoComplete="off"
          placeholder="https://x.ai/bot/marketplace/bots/…"
        />
        <Button type="submit" size="sm" variant="outline">
          Open
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}

export function GrokCatalog({
  q,
  category,
  picked,
  onQuery,
  onCategory,
  onPick,
}: {
  q: string;
  category: string;
  picked: string | undefined;
  onQuery: (q: string) => void;
  onCategory: (c: string) => void;
  onPick: (id: string) => void;
}) {
  const list = useQuery(grokQueries.list());
  const items = list.data;
  const categories = useMemo(() => categoriesOf(items ?? []), [items]);
  const shown = useMemo(() => filterCatalog(items ?? [], q, category), [items, q, category]);
  return (
    <div className="space-y-5">
      <PasteLink onOpen={onPick} />
      <div className="space-y-3">
        <Input
          title="Search the marketplace"
          hiddenLabel
          required={false}
          container="max-w-md"
          value={q}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search by name, creator or what it does"
        />
        {categories.length > 0 && (
          <CategoryChips categories={categories} value={category} onChange={onCategory} />
        )}
      </div>
      {list.isPending && <Loading />}
      {list.isError && (
        <Alert theme="danger">
          {errorMessage(list.error, "The Grok Bot marketplace could not be read.")}
        </Alert>
      )}
      {items && shown.length === 0 && (
        <Empty>No bot matches. Try other words or another category.</Empty>
      )}
      {shown.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Grok Bot marketplace"
          className="grid gap-3 xl:grid-cols-2"
        >
          {shown.map((b) => (
            <CatalogCard key={b.id} bot={b} checked={picked === b.id} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogCard({
  bot,
  checked,
  onPick,
}: {
  bot: GrokListItem;
  checked: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <Choice
      name="grok"
      value={bot.id}
      checked={checked}
      onSelect={onPick}
      title={bot.name}
      art={
        <BotAvatar bot={{ id: bot.id, avatar: bot.avatar }} size={44} square className="shrink-0" />
      }
    >
      <span className="line-clamp-3 text-pretty">{bot.summary}</span>
      <span className="mt-1.5 block text-xs text-muted-foreground">
        by {bot.creatorName || "an unknown creator"}
      </span>
    </Choice>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** What the chosen bot holds, and the one way on: have the person's Chief adapt it into a draft to review. Creates nothing. */
export function GrokPreviewPanel({
  id,
  busy,
  onAdapt,
}: {
  id: string;
  busy: boolean;
  onAdapt: (id: string) => void;
}) {
  const preview = useQuery(grokQueries.preview(id));
  if (preview.isPending)
    return (
      <aside aria-label="Chosen bot" className="lg:sticky lg:top-8 lg:self-start">
        <Loading />
      </aside>
    );
  if (preview.isError)
    return (
      <aside aria-label="Chosen bot" className="lg:sticky lg:top-8 lg:self-start">
        <Alert theme="danger">{errorMessage(preview.error, "That bot could not be read.")}</Alert>
      </aside>
    );
  const p = preview.data;
  return (
    <aside aria-label="Chosen bot" className="lg:sticky lg:top-8 lg:self-start">
      <section
        aria-label={`${p.name} from the Grok Bot marketplace`}
        className="space-y-5 rounded-lg border bg-card p-5 text-sm"
      >
        <header className="flex items-start gap-3">
          <BotAvatar bot={{ id: p.id, avatar: p.avatar }} size={48} square className="shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight">{p.name}</h2>
            <p className="text-xs text-muted-foreground">
              by {p.creatorName || "an unknown creator"}
            </p>
            <p className="mt-1.5 line-clamp-6 text-pretty text-muted-foreground">{p.description}</p>
          </div>
        </header>

        <div className="flex flex-col gap-2">
          <Button type="button" disabled={busy} onClick={() => onAdapt(p.id)}>
            {busy ? "Adapting… this can take a minute or two" : "Adapt and review"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Your Chief writes what the marketplace does not show, such as the full steps of each
            skill. You read and change everything before anything is created.
          </p>
        </div>

        {p.skills.length > 0 && (
          <Section title={`Skills (${p.skills.length})`}>
            <ul className="space-y-1.5">
              {p.skills.map((s) => (
                <li key={s.name}>
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">{s.description}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {p.memories.length > 0 && (
          <Section title="Notes it starts with">
            <p className="text-muted-foreground">
              {p.memories.length} fact{p.memories.length === 1 ? "" : "s"} the bot already knows.
            </p>
          </Section>
        )}
        {p.routines.length > 0 && (
          <Section title="Scheduled runs">
            <ul className="space-y-1.5">
              {p.routines.map((r) => (
                <li key={r.name}>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{r.schedule}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {p.integrations.length > 0 && (
          <Section title="Needs">
            <ul className="space-y-1.5">
              {p.integrations.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-2">
                  <span>{i.name}</span>
                  {i.pluginId ? (
                    <Badge tone="success">Zetta has a plugin</Badge>
                  ) : (
                    <Badge>No Zetta equivalent</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
        <p className="text-xs text-muted-foreground">
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            See it on the marketplace
          </a>
        </p>
      </section>
    </aside>
  );
}
