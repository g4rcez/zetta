import {
  ArrowBendUpLeftIcon,
  BookmarkSimpleIcon,
  ChatTextIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PushPinIcon,
  SmileyIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { ActionHint } from "@/components/action-hint";
import { Button, Dropdown } from "@/components/ui";

import { rateable, useFeedback } from "../bot-quality/feedback";
import { useCopy } from "../shared/use-copy";
import type { Row } from "./chat-rows";
import { EmojiPicker } from "./emoji-picker";

const ignoreCopyFailure = () => {};

/** One line of the action sheet: an icon and a word, as wide as the sheet so a thumb hits it. */
function SheetItem({
  icon: Glyph,
  onClick,
  pressed,
  children,
}: {
  icon: Icon;
  onClick: () => void;
  pressed?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    // No hint: the button has visible text.
    <Button
      type="button"
      role="menuitem"
      variant="ghost"
      className="h-11 w-full justify-start gap-3 px-3 text-sm"
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
    >
      <Glyph aria-hidden="true" className="size-4" />
      {children}
    </Button>
  );
}

/** The thumbs of the sheet: the same rating the toolbar gives, one tap each. Taking the chosen one again takes the rating back. */
function SheetRate({ row, onDone }: { row: Row; onDone: () => void }) {
  const feedback = useFeedback();
  if (!feedback || !rateable(row)) return null;
  const mine = feedback.ratings[row.id]?.rating;
  const rate = (value: "up" | "down") => {
    onDone();
    void (mine === value ? feedback.clear(row.id) : feedback.rate(row.id, value)).catch(
      ignoreCopyFailure,
    );
  };
  return (
    <>
      <SheetItem icon={ThumbsUpIcon} pressed={mine === "up"} onClick={() => rate("up")}>
        Good answer
      </SheetItem>
      <SheetItem icon={ThumbsDownIcon} pressed={mine === "down"} onClick={() => rate("down")}>
        Bad answer
      </SheetItem>
    </>
  );
}

export type MoreActionsProps = {
  row: Row;
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
 * The action sheet of a message on a screen that cannot hover: a "More" button on every message that opens Quote, Open thread, React,
 * Pin, Copy, Edit (the person's own messages) and the rating of a bot's answer. The toolbar of a desktop keeps these as separate buttons.
 */
export function MoreActions({
  row,
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
  const [view, setView] = useState<"actions" | "react">("actions");
  const { copy } = useCopy(ignoreCopyFailure);
  const close = () => setOpen(false);
  const then = (run: () => void) => () => {
    close();
    run();
  };
  return (
    <Dropdown
      asChild
      open={open}
      onChange={(next) => {
        setOpen(next);
        if (!next) setView("actions");
      }}
      aria-label="Message actions"
      trigger={
        <ActionHint label="More">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="More"
            // "!": the library's .__button sets position: relative, which beat "absolute" and left the button in the row, at its left edge.
            className="!absolute top-0.5 right-2 z-10"
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
            setView("actions");
            onReact(emoji);
          }}
        />
      ) : (
        <div role="menu" aria-label="Message actions" className="flex w-56 flex-col py-1">
          {onQuote && (
            <SheetItem icon={ArrowBendUpLeftIcon} onClick={then(onQuote)}>
              Quote
            </SheetItem>
          )}
          {!inThread && (
            <SheetItem icon={ChatTextIcon} onClick={then(onReply)}>
              Open thread
            </SheetItem>
          )}
          <SheetItem icon={SmileyIcon} onClick={() => setView("react")}>
            React
          </SheetItem>
          {onPin && (
            <SheetItem icon={PushPinIcon} onClick={then(onPin)}>
              {pinned ? "Unpin" : "Pin"}
            </SheetItem>
          )}
          <SheetItem icon={CopyIcon} onClick={then(() => void copy(row.content))}>
            Copy
          </SheetItem>
          {onEdit && (
            <SheetItem icon={PencilSimpleIcon} onClick={then(onEdit)}>
              Edit
            </SheetItem>
          )}
          <SheetRate row={row} onDone={close} />
          {row.role === "assistant" && (
            <SheetItem icon={BookmarkSimpleIcon} onClick={then(onSaveToMemory)}>
              Save to memory
            </SheetItem>
          )}
        </div>
      )}
    </Dropdown>
  );
}
