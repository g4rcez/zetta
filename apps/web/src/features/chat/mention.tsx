import { ChatsIcon, UsersIcon } from "@phosphor-icons/react";
import { cn } from "@zetta/ui/lib/utils";
import type { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { legacyMentions, mentionIds, mentionToken, parseMentions } from "@zetta/core/mentions";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot } from "@/components/bot-status";
import {
  Editor,
  EditorField,
  type EditorFieldProps,
  type EditorProps,
} from "@/components/editor/editor";
import { mentionChips, refreshMentionChips } from "@/components/editor/mention-chips";

import { discussionsQueries } from "../discussions/discussions-api";
import { teamsQueries } from "../teams/teams-api";
import type { Bot } from "./chat-client";
import { matchTrigger } from "./triggers";

/** The word that follows `@` for a bot: its name without spaces. Only the picker's hint and a hand-typed `@Name` use it; the text names a bot by id. */
export const mentionKey = (name: string) => name.replace(/\s+/g, "");

/**
 * The bots that `text` tags, in the order of `bots`: by the id in a mention token (`[@Dev](bot:<id>)`), so a rename keeps working,
 * or by a hand-typed `@Name` (the server turns it into a token when it stores the text).
 */
export function mentionedBots(text: string, bots: Bot[]): Bot[] {
  const ids = new Set(mentionIds(text, "bot"));
  const keys = new Set(
    legacyMentions(text)
      .filter((m) => m.sigil === "@")
      .map((m) => m.key),
  );
  return bots.filter((b) => ids.has(b.id) || keys.has(mentionKey(b.name).toLowerCase()));
}

/** `text` with every tag of `bot` removed, token or hand-typed `@Name`. */
export function withoutMention(text: string, bot: Bot): string {
  const key = mentionKey(bot.name).toLowerCase();
  const found = [
    ...parseMentions(text).filter((m) => m.kind === "bot" && m.id === bot.id),
    ...legacyMentions(text).filter((m) => m.sigil === "@" && m.key === key),
  ].sort((a, b) => b.index - a.index);
  return found
    .reduce((out, m) => out.slice(0, m.index) + out.slice(m.index + m.length), text)
    .replace(/ {2,}/g, " ")
    .trim();
}

/** `text` with the mention token of `bot` added at the end, unless the bot is already tagged. */
export function withMention(text: string, bot: Bot): string {
  if (mentionedBots(text, [bot]).length) return text;
  const pad = text && !/\s$/.test(text) ? " " : "";
  return `${text}${pad}${mentionToken("bot", bot.id, bot.name)} `;
}

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
  bots,
  viewRef,
  onError,
}: {
  bots: Bot[];
  viewRef: RefObject<EditorView | null>;
  onError?: (e: unknown) => void;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<State>();
  const [tags, setTags] = useState<Tag[]>();
  // Mention tokens in the text are drawn as chips with the current name of the bot, team or room.
  const names = useRef(new Map<string, string>());
  names.current = new Map([...bots, ...(tags ?? [])].map((x) => [x.id, x.name]));
  const extensions = useMemo(() => mentionChips((id) => names.current.get(id)), []);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshMentionChips.of(null) });
  }, [bots, tags, viewRef]);
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
    // `coordsAtPos` is null when the caret is out of view (or the editor has no layout): the list then sits under the box.
    const c = viewRef.current?.coordsAtPos(caret);
    const point = c ? { x: c.left, y: c.top, lineHeight: c.bottom - c.top } : undefined;
    setState(m ? { ...m, index: 0, point } : undefined);
    if (team && !tags)
      Promise.all([
        qc.fetchQuery(teamsQueries.list()),
        qc.fetchQuery(discussionsQueries.list()),
      ]).then(([teams, rooms]) => {
        setTags([
          ...teams.map((t) => ({ id: t.id, name: t.name, kind: "team" as const })),
          ...rooms
            .filter((d) => d.kind === "room")
            .map((d) => ({ id: d.id, name: d.title, kind: "room" as const })),
        ]);
      }, onError);
  };
  function pick(b: Bot | Tag) {
    const view = viewRef.current;
    if (!state || !view) return;
    const end = state.at + 1 + state.query.length,
      insert = `${mentionToken(isTag(b) ? b.kind : "bot", b.id, b.name)} `;
    view.dispatch({
      changes: { from: state.at, to: end, insert },
      selection: { anchor: state.at + insert.length },
    });
    view.focus();
    setState(undefined);
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
  return { track, close, onKeyDown, extensions, state, candidates, pick };
}

type Mention = ReturnType<typeof useMention>;

/** The open picker of `useMention`. "caret" opens the list under the caret, or above it when the window has no room below. */
export function MentionPopup({
  mention: { state, candidates, pick },
  placement,
}: {
  mention: Pick<Mention, "state" | "candidates" | "pick">;
  placement: "above" | "below" | "caret";
}) {
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
}

type MentionProps = {
  bots: Bot[];
  onKeyDown?: ((e: KeyboardEvent) => void) | undefined;
  onBlur?: (() => void) | undefined;
};

/**
 * A form text box where typing `@` offers the bots and `#` the teams and rooms, like the chat message box.
 * Controlled with `value` and `onChange`, or uncontrolled in a `<form>` with `name` and `defaultValue` (the form reads it as before).
 */
export function MentionTextarea({
  bots,
  className,
  onKeyDown,
  onBlur,
  ...rest
}: Omit<EditorFieldProps, "viewRef" | "onSelect" | "onBlur" | "onKeyDown"> & MentionProps) {
  const viewRef = useRef<EditorView | null>(null);
  const mention = useMention({ bots, viewRef });
  return (
    <div className={cn("relative", className)}>
      <EditorField
        {...rest}
        viewRef={viewRef}
        extensions={mention.extensions}
        onSelect={mention.track}
        // While the list is open it owns the arrows, Enter, Tab and Escape.
        onKeyDown={(e) => {
          if (!mention.onKeyDown(e)) onKeyDown?.(e);
        }}
        onBlur={() => {
          mention.close();
          onBlur?.();
        }}
      />
      <MentionPopup mention={mention} placement="caret" />
    </div>
  );
}

/**
 * The chat's text box and nothing else: the editor where `@` offers the bots and `#` the teams and rooms. Style it with
 * `className` (the editor) and `wrapperClassName` (the box around it and its list); the caller adds its own button and shortcuts.
 */
export function MentionField({
  bots,
  wrapperClassName,
  onKeyDown,
  onBlur,
  ...rest
}: Omit<EditorProps, "viewRef" | "onSelect" | "onBlur" | "onKeyDown"> &
  MentionProps & { wrapperClassName?: string }) {
  const viewRef = useRef<EditorView | null>(null);
  const mention = useMention({ bots, viewRef });
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Editor
        {...rest}
        viewRef={viewRef}
        extensions={mention.extensions}
        onSelect={mention.track}
        // While the list is open it owns the arrows, Enter, Tab and Escape.
        onKeyDown={(e) => {
          if (!mention.onKeyDown(e)) onKeyDown?.(e);
        }}
        onBlur={() => {
          mention.close();
          onBlur?.();
        }}
      />
      <MentionPopup mention={mention} placement="caret" />
    </div>
  );
}
