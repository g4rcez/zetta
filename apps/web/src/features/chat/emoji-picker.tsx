import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { saveLocal } from "@/lib/local-storage";

type Emoji = { label: string; unicode: string; group: number; tags: string[] };
type Catalog = {
  emojis: Emoji[];
  groups: { key: string; label: string; icon: string; order: number }[];
};

/** Unicode groups that are real emoji (skips "component" modifiers and regional-indicator letters). */
const SKIPPED_GROUPS = new Set([2]);
const GROUP_ICONS: Record<string, string> = {
  "smileys-emotion": "😀",
  "people-body": "👋",
  "animals-nature": "🐻",
  "food-drink": "🍔",
  "travel-places": "✈️",
  activities: "⚽",
  objects: "💡",
  symbols: "❤️",
  flags: "🏁",
};
const RECENT_KEY = "zetta.recent-emojis";
const RECENT_MAX = 16;

let catalog: Promise<Catalog> | undefined;
/** Loads the Unicode emoji set once, lazily, so its ~500KB stays out of the main bundle. */
function loadCatalog(): Promise<Catalog> {
  catalog ??= Promise.all([
    import("emojibase-data/en/compact.json"),
    import("emojibase-data/en/messages.json"),
  ]).then(([data, messages]) => ({
    emojis: (
      data.default as {
        label: string;
        unicode: string;
        group?: number;
        tags?: string[];
        order?: number;
      }[]
    )
      .filter(
        (e): e is Emoji & { order?: number } =>
          e.group !== undefined && !SKIPPED_GROUPS.has(e.group),
      )
      .map((e) => ({ label: e.label, unicode: e.unicode, group: e.group, tags: e.tags ?? [] })),
    groups: messages.default.groups
      .filter((g) => !SKIPPED_GROUPS.has(g.order) && g.key !== "component")
      .map((g) => ({
        key: g.key,
        label: g.message,
        icon: GROUP_ICONS[g.key] ?? "🙂",
        order: g.order,
      })),
  }));
  return catalog;
}

function readRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}
function rememberRecent(emoji: string) {
  saveLocal(RECENT_KEY, [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX));
}

/** Searchable picker over every Unicode emoji, grouped by category, with a "recent" row. Calls `onPick` and leaves closing to the caller. */
export function EmojiPicker({
  onPick,
  searchRef,
}: {
  onPick: (emoji: string) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}) {
  const [data, setData] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Emoji>();
  const [recent] = useState(readRecent);
  const scroller = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(query.trim().toLowerCase());
  useEffect(() => {
    loadCatalog().then(setData, () => setFailed(true));
  }, []);

  const sections = useMemo(() => {
    if (!data) return [];
    if (deferred) {
      const hits = data.emojis.filter(
        (e) => e.label.includes(deferred) || e.tags.some((t) => t.includes(deferred)),
      );
      return [
        {
          key: "results",
          label: hits.length
            ? `${hits.length} result${hits.length === 1 ? "" : "s"}`
            : "No emoji found",
          emojis: hits,
        },
      ];
    }
    const byUnicode = new Map(data.emojis.map((e) => [e.unicode, e]));
    const recents = recent.map((u) => byUnicode.get(u)).filter((e): e is Emoji => !!e);
    return [
      ...(recents.length ? [{ key: "recent", label: "Recently used", emojis: recents }] : []),
      ...data.groups.map((g) => ({
        key: g.key,
        label: g.label,
        emojis: data.emojis.filter((e) => e.group === g.order),
      })),
    ];
  }, [data, deferred, recent]);

  const pick = (e: Emoji) => {
    rememberRecent(e.unicode);
    onPick(e.unicode);
  };
  const jump = (key: string) =>
    scroller.current?.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ block: "start" });

  return (
    <div className="flex w-80 flex-col gap-2" role="dialog" aria-label="Emoji picker">
      <Input
        ref={searchRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji"
        title="Search emoji"
        hiddenLabel
        size="small"
      />
      {!deferred && data && (
        <nav aria-label="Emoji categories" className="flex justify-between border-b pb-1">
          {data.groups.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-label={g.label}
              title={g.label}
              onClick={() => jump(g.key)}
              className="rounded px-1 text-base leading-7 grayscale hover:bg-accent hover:grayscale-0"
            >
              {g.icon}
            </button>
          ))}
        </nav>
      )}
      <div
        ref={scroller}
        className="h-64 overflow-y-auto pr-1"
        onMouseLeave={() => setHover(undefined)}
      >
        {!data && !failed && (
          <p className="p-4 text-center text-muted-foreground" aria-live="polite">
            Loading emoji…
          </p>
        )}
        {failed && (
          <p role="alert" className="p-4 text-center text-destructive">
            Couldn't load the emoji list.
          </p>
        )}
        {sections.map((s) => (
          <section key={s.key} data-section={s.key} aria-label={s.label}>
            <h3 className="sticky top-0 z-10 bg-popover py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {s.label}
            </h3>
            <div className="grid grid-cols-8">
              {s.emojis.map((e) => (
                <button
                  key={e.unicode}
                  type="button"
                  aria-label={e.label}
                  onClick={() => pick(e)}
                  onMouseEnter={() => setHover(e)}
                  onFocus={() => setHover(e)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded text-xl leading-none hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  )}
                >
                  {e.unicode}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p
        className="flex h-5 items-center gap-1.5 truncate border-t pt-1.5 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {hover ? (
          <>
            <span className="text-sm leading-none">{hover.unicode}</span>
            <span className="truncate">{hover.label}</span>
          </>
        ) : (
          "Pick an emoji to react"
        )}
      </p>
    </div>
  );
}
