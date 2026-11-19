import { useState, type ReactNode } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { Input } from "@/components/ui";
import { PersonIdentity } from "@/components/person-identity";
import { cn } from "@zetta/ui/lib/utils";
import { useBotAvatars } from "./org-bits";
import type { OrgHolderInput, OrgPalette } from "./org-api";

/** What was picked: who holds the seat. */
export type HolderChoice = { holder: OrgHolderInput };

const matches = (name: string, q: string) => !q || name.toLowerCase().includes(q);

function PickRow({
  picked,
  disabled,
  onPick,
  children,
}: {
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        disabled={disabled}
        onClick={onPick}
        className={cn(
          "flex w-full min-w-0 items-center rounded-lg border bg-card px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60",
          picked && "border-primary bg-primary/5",
        )}
      >
        {children}
      </button>
    </li>
  );
}

type Tab = "people" | "bots";

function TabButton({
  picked,
  onPick,
  children,
}: {
  picked: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        picked && "bg-muted font-medium",
      )}
    >
      {children}
    </button>
  );
}

function PrivateMark() {
  return (
    <span className="shrink-0 rounded border px-1 text-xs font-normal text-muted-foreground">
      Private
    </span>
  );
}

/**
 * Who can hold a seat: the people of the team and the bots, in one searchable list. The admin's own private bots are listed too; picking
 * one asks first, because seating it shares it with the team. Picking anything else is done at once.
 */
export function HolderPicker({
  palette,
  current,
  busy,
  allowOpen,
  onPick,
}: {
  palette: OrgPalette;
  /** Marked in the list; none when the seat does not exist yet. */
  current?: OrgHolderInput | undefined;
  busy: boolean;
  /** Offers "Leave it open". */
  allowOpen: boolean;
  onPick: (choice: HolderChoice) => void;
}) {
  const avatarOf = useBotAvatars();
  const [query, setQuery] = useState("");
  // People and bots are two short lists, not one long one: the bots are what most seats are for, so they must not hide under the people.
  const [tab, setTab] = useState<Tab>(current?.kind === "bot" ? "bots" : "people");
  const q = query.trim().toLowerCase();
  // A search looks in both lists, so a name is found whichever list it is in.
  const showPeople = !!q || tab === "people";
  const showBots = !!q || tab === "bots";
  const people = palette.people.filter((p) => matches(p.name, q));
  const bots = palette.bots.filter((b) => matches(b.name, q));
  return (
    <div className="space-y-3">
      <Input
        type="search"
        title="Find a person or a bot"
        hiddenLabel
        placeholder="Find a person or a bot"
        required={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div role="group" aria-label="Who can hold it" className="flex gap-1">
        <TabButton picked={tab === "people"} onPick={() => setTab("people")}>
          People ({palette.people.length})
        </TabButton>
        <TabButton picked={tab === "bots"} onPick={() => setTab("bots")}>
          Bots ({palette.bots.length})
        </TabButton>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
        {allowOpen && (
          <ul>
            <PickRow
              picked={current?.kind === "open"}
              disabled={busy}
              onPick={() => onPick({ holder: { kind: "open" } })}
            >
              <span className="text-sm">Leave it open</span>
            </PickRow>
          </ul>
        )}
        {showPeople && (
          <section aria-label="People" className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">People</h3>
            <ul className="space-y-1">
              {people.map((p) => (
                <PickRow
                  key={p.userId}
                  picked={current?.kind === "person" && current.userId === p.userId}
                  disabled={busy}
                  onPick={() => onPick({ holder: { kind: "person", userId: p.userId } })}
                >
                  <PersonIdentity person={p} size={28} />
                </PickRow>
              ))}
              {people.length === 0 && (
                <li className="text-xs text-muted-foreground">No one matches.</li>
              )}
            </ul>
          </section>
        )}
        {showBots && (
          <section aria-label="Bots" className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Bots</h3>
            <ul className="space-y-1">
              {bots.map((b) => (
                <PickRow
                  key={b.id}
                  picked={current?.kind === "bot" && current.botId === b.id}
                  disabled={busy}
                  onPick={() => onPick({ holder: { kind: "bot", botId: b.id } })}
                >
                  <BotIdentity
                    bot={{ ...b, avatar: avatarOf(b.id, b.avatar) }}
                    size={28}
                    sub={b.description}
                    trailing={
                      b.visibility === "private" || b.kind === "chief" ? <PrivateMark /> : undefined
                    }
                  />
                </PickRow>
              ))}
              {bots.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  {palette.bots.length === 0
                    ? "You have no bot yet. Create one from the Bots page."
                    : "No bot matches."}
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
