import { useState, type ReactNode } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { Button, Input } from "@/components/ui";
import { PersonIdentity } from "@/components/person-identity";
import { cn } from "@zetta/ui/lib/utils";
import type { OrgHolderInput, OrgPalette, OrgShareBot } from "./org-api";

/** What was picked: who holds the seat, and whether a private bot is shared with the team for it. */
export type HolderChoice = { holder: OrgHolderInput; shareBot?: OrgShareBot };

type PaletteBot = OrgPalette["bots"][number];

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

/** The question before a private bot goes into a seat: the bot is shared with the whole team first. */
function ShareQuestion({
  bot,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  bot: PaletteBot;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={`Share ${bot.name} with the team`}
      className="space-y-2 rounded-lg border border-warn/50 bg-card p-3 text-sm"
    >
      <p className="text-pretty">
        Share <span className="font-medium">{bot.name}</span> with the team? Everyone in the team
        can then see it and talk to it. A seat can only be held by a bot the team can see.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
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
  confirmLabel,
  allowOpen,
  onPick,
}: {
  palette: OrgPalette;
  /** Marked in the list; none when the seat does not exist yet. */
  current?: OrgHolderInput | undefined;
  busy: boolean;
  /** The button that shares a private bot and picks it. */
  confirmLabel: string;
  /** Offers "Leave it open". */
  allowOpen: boolean;
  onPick: (choice: HolderChoice) => void;
}) {
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState<string>();
  // People and bots are two short lists, not one long one: the bots are what most seats are for, so they must not hide under the people.
  const [tab, setTab] = useState<Tab>(current?.kind === "bot" ? "bots" : "people");
  const q = query.trim().toLowerCase();
  // A search looks in both lists, so a name is found whichever list it is in.
  const showPeople = !!q || tab === "people";
  const showBots = !!q || tab === "bots";
  const people = palette.people.filter((p) => matches(p.name, q));
  const bots = palette.bots.filter((b) => matches(b.name, q));
  const question = palette.bots.find((b) => b.id === asking);
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
      {question && (
        <ShareQuestion
          bot={question}
          confirmLabel={confirmLabel}
          busy={busy}
          onCancel={() => setAsking(undefined)}
          onConfirm={() => {
            setAsking(undefined);
            onPick({ holder: { kind: "bot", botId: question.id }, shareBot: "team" });
          }}
        />
      )}
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
                  onPick={() =>
                    b.visibility === "private"
                      ? setAsking(b.id)
                      : onPick({ holder: { kind: "bot", botId: b.id } })
                  }
                >
                  <BotIdentity
                    bot={b}
                    size={28}
                    sub={b.description}
                    trailing={b.visibility === "private" ? <PrivateMark /> : undefined}
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
