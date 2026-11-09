/**
 * The conventions item: one memory item, written by the person, that tells their bots how the memory is organized (the "schema" of an
 * LLM-maintained wiki). The learn, review and ingest prompts carry it, and so does the notes snapshot of a new chat. A bot never creates
 * it and never changes it, and its level is never `edit`: it is the person's instruction to their bots, so it must not be bot-writable.
 */
export const CONVENTIONS_SLUG = "memory-conventions";
export const CONVENTIONS_TAG = "conventions";
export const CONVENTIONS_TITLE = "Memory conventions";
export const CONVENTIONS_HOWTO =
  "How this memory is organized: kinds of item, naming, what to save. Read it before you write items.";
/** What a job prompt carries, and what the notes snapshot of a chat carries. Longer text is cut: keep the item short. */
export const CONVENTIONS_PROMPT_CHARS = 1500;
export const CONVENTIONS_SNAPSHOT_CHARS = 1200;

/** The text used until the person writes their own. */
export const DEFAULT_CONVENTIONS = `How my memory is organized. Bots follow this when they write items.

Kinds of item (tag each one):
- source: the unchanged text of a document, page or file. Never rewrite it. Cite it as [[slug]].
- summary: what one source says, in a few lines, linking to it.
- entity: one person, client, system, account or place.
- concept: one idea, process or rule that several items use.
- decision: what was decided, why and when.
- instruction: numbered steps to follow next time.
- gotcha: a problem and its fix.

Rules:
- One topic per item. Slugs are lower-case words joined by hyphens (acme-billing). Search before you write, and change the item that exists instead of writing a second one.
- Every item says in "howto" when to open it, and links related items with [[slug]].
- Cite where a fact came from. When a new source contradicts an item, say so in that item with both dates; never overwrite it silently.
- Save what another bot needs later: where things are, how systems behave, decisions and their reasons. Never save secrets, one-off details or chat.`;

/** Cuts to a character budget on a code point boundary, and says so when it cuts. */
export function fitConventions(text: string, chars: number) {
  const points = [...text.trim()];
  return points.length <= chars ? points.join("") : `${points.slice(0, chars - 1).join("")}…`;
}
