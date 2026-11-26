import {
  ArrowBendUpLeftIcon,
  BookmarkSimpleIcon,
  ChatTextIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PushPinIcon,
  SmileyIcon,
} from "@phosphor-icons/react";
import { useState, type KeyboardEvent } from "react";

import { ActionHint } from "@/components/action-hint";
import { Button, Dropdown, DROPDOWN_PICKER, DROPDOWN_ROWS } from "@/components/ui";
import { toast } from "@/lib/notify";

import { RateRows, RatingNote } from "../bot-quality/feedback";
import { ListenMenuRow } from "../voice/listen-button";
import type { Row } from "./chat-rows";
import { EmojiPicker } from "./emoji-picker";
import { MenuRow } from "./menu-row";

/** `toolbar`: the "⋯" of the desktop toolbar. `sheet`: the one button every message has on a screen that cannot hover. */
export type ActionsPlacement = "toolbar" | "sheet";

const copyText = (text: string) =>
  void Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(
      () => toast.success("Copied"),
      () => toast.error("Could not copy the message."),
    );

/** Arrow keys, Home and End walk the rows, as a menu does. Tab still leaves it. */
function walkMenu(e: KeyboardEvent<HTMLDivElement>) {
  const step = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: 0 }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? rows.length - 1
        : (at + step + rows.length) % rows.length;
  rows[next]?.focus();
}

export type MoreActionsProps = {
  row: Row;
  placement?: ActionsPlacement;
  inThread: boolean;
  pinned: boolean;
  onReact: (emoji: string) => void;
  /** Open the thread of the message. */
  onReply: () => void;
  onQuote: (() => void) | undefined;
  onPin: (() => void) | undefined;
  /** Only for a message the person may edit. */
  onEdit: (() => void) | undefined;
  onSaveToMemory: () => void;
};

/**
 * The menu of a message. In the toolbar it holds what has no button of its own: the rating of a bot's answer, Pin, Copy, Listen, Edit
 * (the person's own messages) and Save to memory. On a touch screen there is no toolbar, so it also holds Quote, Open thread and React.
 */
export function MoreActions({
  row,
  placement = "sheet",
  inThread,
  pinned,
  onReact,
  onReply,
  onQuote,
  onPin,
  onEdit,
  onSaveToMemory,
}: MoreActionsProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"actions" | "react" | "note">("actions");
  const sheet = placement === "sheet";
  const label = sheet ? "More" : "More actions";
  const close = () => {
    setOpen(false);
    setView("actions");
  };
  const then = (run: () => void) => () => {
    close();
    run();
  };
  const ratings = <RateRows row={row} onDone={close} onNote={() => setView("note")} />;
  const edit = onEdit && (
    <MenuRow icon={PencilSimpleIcon} onClick={then(onEdit)}>
      Edit
    </MenuRow>
  );
  const listen = row.role === "assistant" && !row.streaming && (
    <ListenMenuRow id={row.id} text={row.content} botId={row.botId ?? undefined} onDone={close} />
  );
  return (
    <Dropdown
      asChild
      open={open}
      onChange={(next) => (next ? setOpen(true) : close())}
      aria-label="Message actions"
      className={view === "react" ? DROPDOWN_PICKER : DROPDOWN_ROWS}
      trigger={
        <ActionHint label={label}>
          <Button
            size={sheet ? "icon-sm" : "icon-xs"}
            variant="ghost"
            aria-label={label}
            // "!": the library's .__button sets position: relative, which beat "absolute" and left the button in the row, at its left edge.
            className={sheet ? "!absolute top-0.5 right-2 z-10" : ""}
          >
            <DotsThreeIcon weight="bold" />
          </Button>
        </ActionHint>
      }
    >
      {view === "react" ? (
        <EmojiPicker
          onPick={(emoji) => {
            close();
            onReact(emoji);
          }}
        />
      ) : view === "note" ? (
        <RatingNote row={row} onDone={close} />
      ) : (
        <div
          role="menu"
          aria-label="Message actions"
          data-placement={placement}
          className="flex w-56 flex-col"
          onKeyDown={walkMenu}
        >
          {sheet ? (
            <>
              {onQuote && (
                <MenuRow icon={ArrowBendUpLeftIcon} onClick={then(onQuote)}>
                  Quote
                </MenuRow>
              )}
              {!inThread && (
                <MenuRow icon={ChatTextIcon} onClick={then(onReply)}>
                  Open thread
                </MenuRow>
              )}
              <MenuRow icon={SmileyIcon} onClick={() => setView("react")}>
                React
              </MenuRow>
            </>
          ) : (
            ratings
          )}
          {onPin && (
            <MenuRow icon={PushPinIcon} onClick={then(onPin)}>
              {pinned ? "Unpin" : "Pin"}
            </MenuRow>
          )}
          <MenuRow icon={CopyIcon} onClick={then(() => copyText(row.content))}>
            Copy
          </MenuRow>
          {sheet ? (
            <>
              {edit}
              {listen}
              {ratings}
            </>
          ) : (
            <>
              {listen}
              {edit}
            </>
          )}
          {row.role === "assistant" && (
            <MenuRow icon={BookmarkSimpleIcon} onClick={then(onSaveToMemory)}>
              Save to memory
            </MenuRow>
          )}
        </div>
      )}
    </Dropdown>
  );
}
