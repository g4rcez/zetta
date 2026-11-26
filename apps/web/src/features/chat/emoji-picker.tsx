import { ActionHint } from "@/components/action-hint";
import {
  AirplaneIcon,
  ClockIcon,
  FlagIcon,
  HamburgerIcon,
  HandIcon,
  HashIcon,
  LeafIcon,
  LightbulbIcon,
  SmileyIcon,
  SoccerBallIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { saveLocal } from "@/lib/local-storage";
import { countUse, frequentEmoji, parseUses } from "./emoji-frequency";

type Emoji = { label: string; unicode: string; group: number; tags: string[] };
type Catalog = {
  emojis: Emoji[];
  groups: { key: string; label: string; order: number }[];
};

/** Unicode groups that are real emoji (skips "component" modifiers and regional-indicator letters). */
const SKIPPED_GROUPS = new Set([2]);
const GROUP_ICONS: Record<string, Icon> = {
  "smileys-emotion": SmileyIcon,
  "people-body": HandIcon,
  "animals-nature": LeafIcon,
  "food-drink": HamburgerIcon,
  "travel-places": AirplaneIcon,
  activities: SoccerBallIcon,
  objects: LightbulbIcon,
  symbols: HashIcon,
  flags: FlagIcon,
};
const FREQUENT = "frequent";
/** The recent list from before picks were counted; read only, to fill "Frequently used". */
const RECENT_KEY = "zetta.recent-emojis";
const USE_KEY = "zetta.emoji-use";

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
      .map((g) => ({ key: g.key, label: g.message, order: g.order })),
  }));
  return catalog;
}

function readStored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
const readUses = () => parseUses(readStored(USE_KEY));
function readFrequent(): string[] {
  const older = readStored(RECENT_KEY);
  return frequentEmoji(
    readUses(),
    Array.isArray(older) ? older.filter((x): x is string => typeof x === "string") : [],
  );
}

/** One category of the picker's tab row; the open one is underlined. */
function CategoryTab({
  label,
  icon: Glyph,
  current,
  disabled,
  onClick,
}: {
  label: string;
  icon: Icon;
  current: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <ActionHint label={label}>
      <button
        type="button"
        aria-label={label}
        aria-current={current ? "true" : undefined}
        disabled={disabled}
        onClick={onClick}
        className="flex h-8 w-7 items-center justify-center border-b-2 border-transparent text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 aria-[current]:border-primary aria-[current]:text-foreground"
      >
        <Glyph aria-hidden="true" className="size-4" />
      </button>
    </ActionHint>
  );
}

/**
 * Searchable picker over every Unicode emoji, laid out as Slack's: category tabs, search, "Frequently used" and then each category.
 * Calls `onPick` and leaves closing to the caller.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [data, setData] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Emoji>();
  // Read once: the section must not reshuffle while the picker is open.
  const [frequent] = useState(readFrequent);
  const [active, setActive] = useState(FREQUENT);
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
    const mine = frequent.map((u) => byUnicode.get(u)).filter((e): e is Emoji => !!e);
    return [
      { key: FREQUENT, label: "Frequently used", emojis: mine },
      ...data.groups.map((g) => ({
        key: g.key,
        label: g.label,
        emojis: data.emojis.filter((e) => e.group === g.order),
      })),
    ];
  }, [data, deferred, frequent]);

  const pick = (e: Emoji) => {
    saveLocal(USE_KEY, countUse(readUses(), e.unicode));
    onPick(e.unicode);
  };
  const sectionsOnScreen = () => [
    ...(scroller.current?.querySelectorAll<HTMLElement>("[data-section]") ?? []),
  ];
  const jump = (key: string) => {
    const section = sectionsOnScreen().find((el) => el.dataset.section === key);
    if (!section || !scroller.current) return;
    // The list only: `scrollIntoView` would also move the page behind the panel.
    scroller.current.scrollTop = section.offsetTop;
    setActive(key);
  };
  // The tab follows the list: the last section whose top has passed.
  const track = () => {
    const top = scroller.current?.scrollTop ?? 0;
    const passed = sectionsOnScreen().filter((el) => el.offsetTop <= top + 4);
    setActive(passed.at(-1)?.dataset.section ?? FREQUENT);
  };

  return (
    <div className="flex w-80 flex-col gap-2" role="dialog" aria-label="Emoji picker">
      {data && (
        <nav aria-label="Emoji categories" className="flex justify-between border-b">
          <CategoryTab
            label="Frequently used"
            icon={ClockIcon}
            current={!deferred && active === FREQUENT}
            disabled={!!deferred}
            onClick={() => jump(FREQUENT)}
          />
          {data.groups.map((g) => (
            <CategoryTab
              key={g.key}
              label={g.label}
              icon={GROUP_ICONS[g.key] ?? SmileyIcon}
              current={!deferred && active === g.key}
              disabled={!!deferred}
              onClick={() => jump(g.key)}
            />
          ))}
        </nav>
      )}
      <Input
        // The picker opens in a Dropdown, which has no initial-focus prop: autoFocus keeps the focus manager from moving it elsewhere.
        autoFocus
        hiddenLabel
        title="Search emoji"
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji"
      />
      <div
        ref={scroller}
        // `relative`: a section's `offsetTop` is then its place in this list.
        className="relative h-64 overflow-y-auto pr-1"
        onScroll={track}
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
                // No hint: the emoji itself is the visible label.
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
