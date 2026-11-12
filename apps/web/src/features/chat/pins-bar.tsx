import { CaretDownIcon, PushPinIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { ActionHint } from "@/components/action-hint";
import { BotAvatar } from "@/components/bot-avatar";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui";
import { relativeTime } from "@/features/shared/relative-time";
import { cn } from "@zetta/ui/lib/utils";

import type { Pin } from "./chat-client";
import { showMessage, type Author } from "./message-row";

/** Who wrote a pinned message: the small avatar and the name, the way a quote shows its author. */
function PinWho({ author }: { author: Author }) {
  return (
    <>
      {author.bot ? (
        <BotAvatar bot={author.bot} size={16} square />
      ) : (
        <UserAvatar name={author.name} avatar={author.avatar} image={author.image} size={16} />
      )}
      <span className="shrink-0 font-semibold text-foreground">{author.name}</span>
    </>
  );
}

/** One pin in the open list: a click goes to the message; the button unpins it. */
function PinItem({
  pin,
  author,
  onUnpin,
}: {
  pin: Pin;
  author: Author;
  onUnpin: (messageId: string) => void;
}) {
  return (
    <li className="flex items-center gap-1 rounded-md hover:bg-accent/60">
      {/* No hint: it shows the pinned text. */}
      <button
        type="button"
        aria-label={`Go to the pinned message from ${author.name}`}
        onClick={() => showMessage(pin.messageId)}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <PinWho author={author} />
        <span className="truncate text-muted-foreground">{pin.excerpt}</span>
        <span className="ml-auto shrink-0 text-muted-foreground/70">
          {relativeTime(pin.pinnedAt)}
        </span>
      </button>
      <ActionHint label="Unpin">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Unpin the message from ${author.name}`}
          onClick={() => onUnpin(pin.messageId)}
        >
          <XIcon />
        </Button>
      </ActionHint>
    </li>
  );
}

/**
 * The pinned messages of a conversation, above the log so they do not scroll away: the newest pin on one line (who wrote it and its
 * first words), and a count that opens the whole list. A click goes to the message when it is loaded in the log. Nothing shows
 * while nothing is pinned.
 */
export function PinsBar({
  pins,
  authorOfPin,
  onUnpin,
}: {
  pins: readonly Pin[];
  authorOfPin: (pin: Pin) => Author;
  onUnpin: (messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const newest = pins[0];
  if (!newest) return null;
  const author = authorOfPin(newest);
  return (
    <section aria-label="Pinned messages" className="border-b bg-card/50 text-xs">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <PushPinIcon aria-hidden="true" weight="fill" className="size-3.5 shrink-0 text-primary" />
        {/* No hint: it shows the pinned text. */}
        <button
          type="button"
          aria-label={`Go to the pinned message from ${author.name}`}
          onClick={() => showMessage(newest.messageId)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <PinWho author={author} />
          <span className="truncate text-muted-foreground">{newest.excerpt}</span>
        </button>
        {pins.length === 1 && (
          <ActionHint label="Unpin">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Unpin the message from ${author.name}`}
              onClick={() => onUnpin(newest.messageId)}
            >
              <XIcon />
            </Button>
          </ActionHint>
        )}
        {pins.length > 1 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {pins.length} pins
            <CaretDownIcon
              aria-hidden="true"
              className={cn(
                "size-3 transition-transform motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          </button>
        )}
      </div>
      {open && pins.length > 1 && (
        <ul
          aria-label="All pinned messages"
          className="max-h-60 space-y-0.5 overflow-y-auto px-3 pb-2"
        >
          {pins.map((pin) => (
            <PinItem key={pin.messageId} pin={pin} author={authorOfPin(pin)} onUnpin={onUnpin} />
          ))}
        </ul>
      )}
    </section>
  );
}
