import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@zetta/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { cn } from "@zetta/ui/lib/utils";
import { Input } from "@/components/ui";
import { chatClient, type Conversation } from "./chat-client";

/** A bot's threads: its open conversations as tabs, with new, rename, archive and delete. Archived threads wait in a list and come back when opened. */
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
  onUpdate: (id: string, patch: { title?: string; archived?: boolean }) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string>();
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  useEffect(() => {
    if (!archiveOpen) return;
    chatClient.conversations(botId, true).then(setArchived, () => setArchived([]));
  }, [archiveOpen, botId, threads.length]);

  return (
    <div
      role="tablist"
      aria-label="Threads"
      className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
    >
      {threads.map((t) => {
        const active = t.id === chatId;
        return (
          <div
            key={t.id}
            className={cn(
              "group flex max-w-48 shrink-0 items-center rounded-md text-xs",
              active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            {renaming === t.id ? (
              <Input
                autoFocus
                aria-label="Thread name"
                defaultValue={t.title}
                className="h-7 w-40 text-xs"
                onBlur={() => setRenaming(undefined)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(undefined);
                  if (e.key === "Enter") {
                    const title = e.currentTarget.value.trim();
                    if (title && title !== t.title) onUpdate(t.id, { title });
                    setRenaming(undefined);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={t.title}
                onClick={() => onOpen(t.id)}
                className="min-w-0 truncate px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t.title}
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`${t.title} menu`}
                className="mr-0.5 rounded p-1 opacity-60 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem onClick={() => setRenaming(t.id)}>
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onUpdate(t.id, { archived: true })}>
                  <Archive /> Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(t.id)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="New thread"
        title="New thread"
        onClick={onNew}
      >
        <Plus />
      </Button>
      <DropdownMenu open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DropdownMenuTrigger
          aria-label="Archived threads"
          title="Archived threads"
          className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArchiveRestore className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {archived.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No archived threads</div>
          )}
          {archived.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => {
                onUpdate(t.id, { archived: false });
                onOpen(t.id);
              }}
            >
              <span className="truncate">{t.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
