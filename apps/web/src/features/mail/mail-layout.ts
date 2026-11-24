// How the inbox spends the width the page really has (not the window: the app's own sidebar takes a share of it).
// The open conversation is what is being read, so it never gets less than READING. When everything does not fit, space is given up in
// this order: the mailbox column becomes a menu in the list header, then the chat stops being a column.

/** The least width of the open conversation while it is shown. */
export const READING = 420;
/** The mailbox column (`w-60`). */
export const MAILBOXES = 240;
/** The conversation list (`w-96`). */
export const LIST = 384;
/** Limits of the chat column. */
export const CHAT = { min: 320, max: 640, fallback: 400 } as const;

export type MailLayout = {
  /** Mailboxes as a column of their own, or as a menu in the list header. */
  mailboxes: "column" | "menu";
  /** The list and the open conversation side by side, or one at a time (list, then conversation with a way back). */
  panes: "split" | "single";
  /** The chat can be a column beside the conversation. False: it can only take the conversation's place. */
  chatFits: boolean;
  /** The chat is a column now (it fits and was not closed). */
  chatColumn: boolean;
  /** The width of the chat column, kept inside what is left once the other columns have their share. */
  chatWidth: number;
  /** The widest the chat column may be right now. */
  chatMax: number;
};

/** Pure: the same width and panel state always give the same layout. `chatWidth` is the width the person chose (any stored value). */
export function mailLayout(input: {
  width: number;
  chatOpen: boolean;
  chatWidth: number;
}): MailLayout {
  const { width, chatOpen } = input;
  const panes = width >= LIST + READING ? "split" : "single";
  const chatFits = width >= LIST + READING + CHAT.min;
  const chatColumn = chatFits && chatOpen;
  const needed = LIST + READING + (chatColumn ? CHAT.min : 0);
  const mailboxes = width >= needed + MAILBOXES ? "column" : "menu";
  const taken = LIST + READING + (mailboxes === "column" ? MAILBOXES : 0);
  const chatMax = Math.max(CHAT.min, Math.min(CHAT.max, width - taken));
  const chatWidth = Math.min(chatMax, Math.max(CHAT.min, Math.round(input.chatWidth)));
  return { mailboxes, panes, chatFits, chatColumn, chatWidth, chatMax };
}
