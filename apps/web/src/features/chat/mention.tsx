import { cn } from "@zetta/ui/lib/utils";
import { useRef, useState, type ComponentProps, type KeyboardEvent, type RefObject } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot } from "@/components/bot-status";
import { Textarea } from "@/components/ui";

import type { Bot } from "./chat-client";
import { matchTrigger } from "./triggers";

/** The word that follows `@` for a bot: its name without spaces. */
export const mentionKey = (name: string) => name.replace(/\s+/g, "");

const MENTION = /@([\p{L}\p{N}_-]{1,40})/gu;

/** The bots that `text` tags with `@Name`, in the order of `bots`. Same matching as the server (`mentionKey` in discussions/prompt.ts). */
export function mentionedBots(text: string, bots: Bot[]): Bot[] {
  const keys = new Set([...text.matchAll(MENTION)].map((m) => m[1]!.toLowerCase()));
  return bots.filter((b) => keys.has(mentionKey(b.name).toLowerCase()));
}

/** `text` with every `@Name` tag of `bot` removed. */
export function withoutMention(text: string, bot: Bot): string {
  const key = mentionKey(bot.name).toLowerCase();
  return text
    .replace(MENTION, (tag, k: string) => (k.toLowerCase() === key ? "" : tag))
    .replace(/ {2,}/g, " ")
    .trim();
}

/** `text` with `@Name` added at the end, unless the bot is already tagged. */
export function withMention(text: string, bot: Bot): string {
  if (mentionedBots(text, [bot]).length) return text;
  const pad = text && !/\s$/.test(text) ? " " : "";
  return `${text}${pad}@${mentionKey(bot.name)} `;
}

type State = { query: string; at: number; index: number };

/**
 * The `@bot` picker of a text box: finds the `@word` before the caret, lists the matching bots, and writes the choice into the text.
 * The chat composer and the new-room form share it, so `@` behaves the same everywhere.
 */
export function useMention({
  value,
  onChange,
  bots,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  bots: Bot[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [state, setState] = useState<State>();
  const candidates = state
    ? bots
        .filter(
          (b) =>
            b.onboarded && mentionKey(b.name).toLowerCase().startsWith(state.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const close = () => setState(undefined);
  const track = (text: string, caret: number) => {
    const m = matchTrigger(text, caret, "@");
    setState(m ? { ...m, index: 0 } : undefined);
  };
  function pick(b: Bot) {
    if (!state) return;
    const end = state.at + 1 + state.query.length,
      insert = `@${mentionKey(b.name)} `;
    onChange(value.slice(0, state.at) + insert + value.slice(end));
    setState(undefined);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.setSelectionRange(state.at + insert.length, state.at + insert.length);
    });
  }
  /** Handles the arrows, Enter, Tab and Escape while the list is open. Returns true when it took the key. */
  function onKeyDown(e: KeyboardEvent): boolean {
    if (!state || !candidates.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setState({ ...state, index: (state.index + d + candidates.length) % candidates.length });
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(candidates[state.index]!);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setState(undefined);
      return true;
    }
    return false;
  }
  const popup = (placement: "above" | "below") =>
    state && candidates.length > 0 ? (
      <ul
        role="listbox"
        aria-label="Mention a bot"
        className={cn(
          "absolute left-0 z-20 w-72 overflow-hidden rounded-lg border bg-popover p-1 shadow-md",
          placement === "above" ? "bottom-full mb-1" : "top-full mt-1",
        )}
      >
        <li className="px-2 py-1 text-xs font-medium text-muted-foreground" role="presentation">
          Bots
        </li>
        {candidates.map((b, i) => (
          <li
            key={b.id}
            role="option"
            aria-selected={i === state.index}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(b);
            }}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              i === state.index ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            )}
          >
            <BotAvatar
              bot={b}
              size={20}
              square
              badge={<BotStatusDot botId={b.id} className="size-2 border-popover" />}
            />
            <span className="font-medium">{b.name}</span>
            <span className="truncate text-xs text-muted-foreground">@{mentionKey(b.name)}</span>
          </li>
        ))}
      </ul>
    ) : null;
  return { track, close, onKeyDown, popup };
}

type TextareaProps = Omit<ComponentProps<typeof Textarea>, "value" | "onChange">;

/** A form text box where typing `@` offers the bots, like the chat message box. */
export function MentionTextarea({
  value,
  onChange,
  bots,
  className,
  ...rest
}: TextareaProps & { value: string; onChange: (v: string) => void; bots: Bot[] }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mention = useMention({ value, onChange, bots, inputRef });
  return (
    <div className={cn("relative", className)}>
      <Textarea
        {...rest}
        value={value}
        onChange={(e) => {
          inputRef.current = e.currentTarget;
          onChange(e.currentTarget.value);
          mention.track(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onSelect={(e) => {
          inputRef.current = e.currentTarget;
          mention.track(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={(e) => {
          mention.onKeyDown(e);
        }}
        onBlur={mention.close}
      />
      {mention.popup("below")}
    </div>
  );
}
