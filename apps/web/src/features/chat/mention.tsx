import { ChatsIcon, UsersIcon } from "@phosphor-icons/react";
import { cn } from "@zetta/ui/lib/utils";
import {
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot } from "@/components/bot-status";
import { Textarea } from "@/components/ui";

import { discussionsApi } from "../discussions/discussions-api";
import { teamsApi } from "../teams/teams-api";
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

/** Where the caret of a textarea is on screen (viewport pixels): a hidden copy of the text up to the caret, styled like the textarea, tells the offset. */
function caretPoint(el: HTMLTextAreaElement, caret: number) {
  const style = getComputedStyle(el),
    mirror = document.createElement("div"),
    marker = document.createElement("span");
  for (const p of MIRRORED) mirror.style.setProperty(p, style.getPropertyValue(p));
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    overflow: "hidden",
    width: `${el.clientWidth}px`,
  });
  mirror.textContent = el.value.slice(0, caret);
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const rect = el.getBoundingClientRect(),
    lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4,
    x = rect.left + el.clientLeft + marker.offsetLeft - el.scrollLeft,
    y = rect.top + el.clientTop + marker.offsetTop - el.scrollTop;
  mirror.remove();
  return { x, y, lineHeight };
}

const MIRRORED = [
  "boxSizing",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "tabSize",
  "textIndent",
  "textTransform",
  "wordSpacing",
].map((p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

/** The picker is about six rows tall; below this much room it opens above the caret. */
const POPUP_HEIGHT = 260;

/** What `#` offers: a team or a room, shown by its name. */
type Tag = { id: string; name: string; kind: "team" | "room" };

const isTag = (x: Bot | Tag): x is Tag => x.kind === "team" || x.kind === "room";

type State = {
  char: "@" | "#";
  query: string;
  at: number;
  index: number;
  point?: { x: number; y: number; lineHeight: number } | undefined;
};

/**
 * The `@bot` and `#team`/`#room` picker of a text box: finds the `@word` or `#word` before the caret, lists the matching bots, teams or rooms, and writes the choice into the text.
 * The chat composer and the new-room form share it, so `@` and `#` behave the same everywhere.
 */
export function useMention({
  value,
  onChange,
  bots,
  inputRef,
  onError,
}: {
  value: string;
  onChange: (v: string) => void;
  bots: Bot[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onError?: (e: unknown) => void;
}) {
  const [state, setState] = useState<State>();
  const [tags, setTags] = useState<Tag[]>();
  const startsWith = (name: string) =>
    mentionKey(name).toLowerCase().startsWith(state!.query.toLowerCase());
  const botCandidates =
    state?.char === "@" ? bots.filter((b) => b.onboarded && startsWith(b.name)) : [];
  const tagCandidates = state?.char === "#" && tags ? tags.filter((t) => startsWith(t.name)) : [];
  const candidates: (Bot | Tag)[] = [...botCandidates, ...tagCandidates].slice(0, 6);
  const close = () => setState(undefined);
  const track = (text: string, caret: number) => {
    const bot = matchTrigger(text, caret, "@"),
      team = bot ? undefined : matchTrigger(text, caret, "#");
    const m = bot ? { ...bot, char: "@" as const } : team && { ...team, char: "#" as const };
    const el = inputRef.current;
    setState(m ? { ...m, index: 0, point: el ? caretPoint(el, caret) : undefined } : undefined);
    if (team && !tags)
      Promise.all([teamsApi.list(), discussionsApi.list()]).then(([teams, rooms]) => {
        setTags([
          ...teams.map((t) => ({ id: t.id, name: t.name, kind: "team" as const })),
          ...rooms
            .filter((d) => d.kind === "room")
            .map((d) => ({ id: d.id, name: d.title, kind: "room" as const })),
        ]);
      }, onError);
  };
  function pick(b: Bot | Tag) {
    if (!state) return;
    const end = state.at + 1 + state.query.length,
      insert = `${state.char}${mentionKey(b.name)} `;
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
  /** "caret" opens the list under the caret, or above it when the window has no room below. */
  const popup = (placement: "above" | "below" | "caret") => {
    const point = placement === "caret" ? state?.point : undefined;
    const flip = point ? window.innerHeight - point.y - point.lineHeight < POPUP_HEIGHT : false;
    const at: CSSProperties | undefined = point
      ? {
          position: "fixed",
          left: Math.max(8, Math.min(point.x, window.innerWidth - 296)),
          ...(flip
            ? { bottom: window.innerHeight - point.y + 4 }
            : { top: point.y + point.lineHeight + 4 }),
        }
      : undefined;
    return state && candidates.length > 0 ? (
      <ul
        role="listbox"
        aria-label={state.char === "@" ? "Mention a bot" : "Mention a team or room"}
        style={at}
        className={cn(
          "z-50 w-72 overflow-hidden rounded-lg border bg-popover p-1 shadow-md",
          !point && "absolute left-0",
          !point && (placement === "above" ? "bottom-full mb-1" : "top-full mt-1"),
        )}
      >
        <li className="px-2 py-1 text-xs font-medium text-muted-foreground" role="presentation">
          {state.char === "@" ? "Bots" : "Teams and rooms"}
        </li>
        {candidates.map((b, i) => (
          <li
            key={`${isTag(b) ? b.kind : "bot"}-${b.id}`}
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
            {isTag(b) ? (
              b.kind === "team" ? (
                <UsersIcon className="size-5 shrink-0 text-muted-foreground" />
              ) : (
                <ChatsIcon className="size-5 shrink-0 text-muted-foreground" />
              )
            ) : (
              <BotAvatar
                bot={b}
                size={20}
                square
                badge={<BotStatusDot botId={b.id} className="size-2 border-popover" />}
              />
            )}
            <span className="font-medium">{b.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {state.char}
              {mentionKey(b.name)}
            </span>
          </li>
        ))}
      </ul>
    ) : null;
  };
  return { track, close, onKeyDown, popup };
}

type TextareaProps = Omit<ComponentProps<typeof Textarea>, "value" | "defaultValue" | "onChange">;

/**
 * A form text box where typing `@` offers the bots and `#` the teams and rooms, like the chat message box.
 * Controlled with `value` and `onChange`, or uncontrolled in a `<form>` with `name` and `defaultValue` (the form reads it as before).
 */
export function MentionTextarea({
  value,
  defaultValue,
  onChange,
  bots,
  className,
  onKeyDown,
  onBlur,
  ...rest
}: TextareaProps & {
  value?: string;
  defaultValue?: string | undefined;
  onChange?: (v: string) => void;
  bots: Bot[];
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [own, setOwn] = useState(defaultValue ?? "");
  const text = value ?? own;
  const change = (v: string) => {
    if (value === undefined) setOwn(v);
    onChange?.(v);
  };
  const mention = useMention({ value: text, onChange: change, bots, inputRef });
  return (
    <div className={cn("relative", className)}>
      <Textarea
        {...rest}
        value={text}
        onChange={(e) => {
          inputRef.current = e.currentTarget;
          change(e.currentTarget.value);
          mention.track(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onSelect={(e) => {
          inputRef.current = e.currentTarget;
          mention.track(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={(e) => {
          // While the list is open it owns the arrows, Enter, Tab and Escape.
          if (!mention.onKeyDown(e)) onKeyDown?.(e);
        }}
        onBlur={(e) => {
          mention.close();
          onBlur?.(e);
        }}
      />
      {mention.popup("caret")}
    </div>
  );
}

type FieldProps = Omit<ComponentProps<"textarea">, "value" | "defaultValue" | "onChange" | "ref">;

/**
 * The chat's text box and nothing else: a bare `<textarea>` where `@` offers the bots and `#` the teams and rooms. Style it with
 * `className` (the textarea) and `wrapperClassName` (the box around it and its list); the caller adds its own button and shortcuts.
 */
export function MentionField({
  value,
  onChange,
  bots,
  wrapperClassName,
  onKeyDown,
  onBlur,
  ...rest
}: FieldProps & {
  value: string;
  onChange: (v: string) => void;
  bots: Bot[];
  wrapperClassName?: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mention = useMention({ value, onChange, bots, inputRef });
  return (
    <div className={cn("relative", wrapperClassName)}>
      <textarea
        {...rest}
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          mention.track(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onSelect={(e) => mention.track(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          // While the list is open it owns the arrows, Enter, Tab and Escape.
          if (!mention.onKeyDown(e)) onKeyDown?.(e);
        }}
        onBlur={(e) => {
          mention.close();
          onBlur?.(e);
        }}
      />
      {mention.popup("caret")}
    </div>
  );
}
