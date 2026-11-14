import { ActionHint } from "@/components/action-hint";
import {
  ArchiveIcon,
  CaretDownIcon,
  CheckIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { cn } from "@zetta/ui/lib/utils";
import { Button, Dropdown, MENU_DANGER, Menu, MenuItem, MenuSeparator } from "@/components/ui";
import type { Conversation } from "./chat-client";
import { chatQueries } from "./chat-queries";

type View = "open" | "archived";
const NONE: Conversation[] = [];

/**
 * The chat switcher in the chat header (DESIGN.md "Chat"): the open chat's title opens a combobox with a search field, the
 * bot's chats (or its archived chats, which come back when opened) and "New chat". The `⋯` beside it renames, archives or
 * deletes the open chat.
 */
export function ThreadTabs({
  threads,
  botId,
  chatId,
  onOpen,
  onNew,
  onUpdate,
  onDelete,
}: {
  threads: Conversation[];
  botId: string;
  chatId: string | undefined;
  onOpen: (id: string) => void;
  onNew: () => void;
  onUpdate: (id: string, patch: { title?: string; archived?: boolean; favorite?: boolean }) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("open");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const qc = useQueryClient();
  const archivedQuery = useQuery({
    ...chatQueries.archived(botId),
    enabled: open && view === "archived",
  });
  const archived = archivedQuery.isError ? NONE : archivedQuery.data;
  const listId = useId();
  const current = threads.find((t) => t.id === chatId);
  useEffect(() => {
    // Archiving or restoring a chat changes `threads`: the archived list is then out of date.
    void qc.invalidateQueries({ queryKey: chatQueries.archived(botId).queryKey });
  }, [qc, botId, threads.length]);
  useEffect(() => setRenaming(false), [chatId]);
  useEffect(() => {
    if (open) return;
    setQuery("");
    setView("open");
  }, [open]);
  const q = query.trim().toLowerCase();
  const source = view === "archived" ? (archived ?? []) : threads;
  const list = source.filter((t) => !q || t.title.toLowerCase().includes(q));
  useEffect(() => setActive(0), [q, view]);
  const optionId = (id: string) => `${listId}-${id}`;
  const choose = (t: Conversation) => {
    if (view === "archived") onUpdate(t.id, { archived: false });
    onOpen(t.id);
    setOpen(false);
  };

  if (renaming && current) {
    return (
      <input
        autoFocus
        aria-label="Chat name"
        defaultValue={current.title}
        maxLength={120}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setRenaming(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setRenaming(false);
          if (e.key === "Enter") {
            const title = e.currentTarget.value.trim();
            if (title && title !== current.title) onUpdate(current.id, { title });
            setRenaming(false);
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-base outline-none focus-visible:outline-2 focus-visible:outline-ring"
      />
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Dropdown
        open={open}
        onChange={setOpen}
        aria-label="Switch chat"
        buttonProps={{
          className:
            "flex h-8 min-w-0 items-center gap-1 rounded-md px-1.5 text-base font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        }}
        trigger={
          <>
            <span className="truncate">{current?.title ?? "New chat"}</span>
            <span className="sr-only">, switch chat</span>
            <CaretDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        }
      >
        <div className="flex w-80 max-w-[calc(100vw-4rem)] flex-col gap-1 text-sm">
          <input
            autoFocus
            role="combobox"
            aria-label={view === "archived" ? "Search archived chats" : "Search chats"}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={list[active] ? optionId(list[active].id) : undefined}
            placeholder={view === "archived" ? "Search archived chats…" : "Search chats…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!list.length) return;
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((i) => (i + step + list.length) % list.length);
              } else if (e.key === "Enter" && list[active]) {
                e.preventDefault();
                choose(list[active]);
              }
            }}
            className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
          <div role="group" aria-label="Which chats" className="flex gap-1 px-0.5 pt-1">
            {(
              [
                ["open", "Chats"],
                ["archived", "Archived"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "h-6 rounded-md px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring",
                  view === v
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={view === "archived" ? "Archived chats" : "Chats"}
            className="max-h-72 overflow-y-auto"
          >
            {list.map((t, i) => (
              <li
                key={t.id}
                id={optionId(t.id)}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(t)}
                className={cn(
                  "flex h-8 cursor-default items-center gap-2 rounded-md px-2",
                  i === active && "bg-accent",
                )}
              >
                {t.id === chatId ? (
                  <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                ) : (
                  <span aria-hidden="true" className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {t.id === chatId && <span className="sr-only"> (open)</span>}
              </li>
            ))}
            {list.length === 0 && (
              <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">
                {view === "archived" && archived === undefined
                  ? "Loading…"
                  : q
                    ? "No chats match."
                    : view === "archived"
                      ? "No archived chats."
                      : "No chats yet."}
              </li>
            )}
          </ul>
          <div className="border-t pt-1">
            <button
              type="button"
              onClick={() => {
                onNew();
                setOpen(false);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <PlusIcon aria-hidden="true" className="size-4" /> New chat
            </button>
          </div>
        </div>
      </Dropdown>
      {current && (
        <ActionHint label={current.favorite ? "Remove from favorites" : "Add to favorites"}>
          <Button
            variant={current.favorite ? "link" : "ghost"}
            size="icon-sm"
            aria-pressed={!!current.favorite}
            aria-label={current.favorite ? "Remove from favorites" : "Add to favorites"}

            onClick={() => onUpdate(current.id, { favorite: !current.favorite })}
            className="shrink-0"
          >
            <StarIcon
              aria-hidden="true"
              weight={current.favorite ? "fill" : "regular"}
              className="size-4"
            />
          </Button>
        </ActionHint>
      )}
      {current && (
        <Menu
          asChild
          hover={false}
          title=""
          floatingClassName="w-44"
          label={
            <ActionHint label={`Actions for ${current.title}`}>
              <button
                type="button"
                aria-label={`Actions for ${current.title}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-open:bg-muted data-open:text-foreground"
              >
                <DotsThreeIcon aria-hidden="true" className="size-4" />
              </button>
            </ActionHint>
          }
        >
          <MenuItem title="Rename" onClick={() => setRenaming(true)}>
            <PencilSimpleIcon /> Rename
          </MenuItem>
          <MenuItem title="Archive" onClick={() => onUpdate(current.id, { archived: true })}>
            <ArchiveIcon /> Archive
          </MenuItem>
          <MenuSeparator />
          <MenuItem title="Delete" className={MENU_DANGER} onClick={() => onDelete(current.id)}>
            <TrashIcon /> Delete
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
