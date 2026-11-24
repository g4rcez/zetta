# Bots that learn, check and forget

Decided on 2026-11-17 and built in the days after. A report on how the memory of Zetta compares with other tools found that Zetta captures and stores well, and is weak at four steps of the loop: **capture, use, check, forget**. Nothing recorded whether a lesson helped, nothing retired a bad or unused one unless a person pressed a button, and there was no single place that showed what a bot learned. Every number below is a constant in `packages/core/src/learning.ts`.

Three constraints hold for every part: it is cheap in tokens (the daily reading is the only recurring model call), it never learns something wrong silently, and it needs no new infrastructure (Postgres only, no training).

## No automatic rewrites

- A background job never replaces the text of a memory item or a skill, and never archives one. A `write` over an existing item by the learn job becomes a **suggestion** (`memory.suggest`). The review and ingest jobs hold a `write` over an existing item and any `archive` as an approval card, with the reason on the card.
- A skill review that wants a new revision is always a suggestion, even when the bot is set to learn by itself. The per-correction skill review is gone: nothing teaches a bot from one message any more.

## Lessons come from a batch, never from one message

- Once a day per bot (`learning:batch` ticker; **Run now** on the bot's page, one hour apart), Zetta reads that day's chats of the **owner** with the bot: only `chat` conversations, never rooms or inbound chats, and never a user row the server wrote. A bot with fewer than 6 owner messages that day is skipped, and one owner reads at most 10 bots a day. The chats with the most signal come first (corrections, stops, messages added while the bot worked, thumbs with a reason).
- One call to the owner's Chief engine returns at most 8 candidates with a quote each. The engine's claims are never trusted: **Zetta checks them without a model** (`learning/validate.ts`).
  - The quote must exist word for word in a message the owner wrote. A quote in a code fence, a blockquote, an attachment, a message over 4,000 characters, or anything from a web page, a file, another bot or a tool is refused.
  - The text passes the same manipulation and secret screens as every memory write.
  - The lesson must be **seen twice**: in two chats or on two different days. The exception is a rule the person said outright ("from now on", "always", "nunca"): a regular expression on the quote's own sentence decides that, not the model.
- A lesson is one sentence of at most 300 characters, kept as a small memory item (tag `lesson`, type `solo`, written by the system, `botAccess: suggest`). Longer procedures stay candidates a person can turn into an item.
- `autoLearn` keeps its meaning: off, nothing is read; suggest, validated candidates wait for the person; auto, they go on trial. A waiting candidate expires after 30 days.

## Use: lessons in the prompt, and a record of what was used

- Lessons have a block of their own in the prompt ("YOUR LESSONS", at most 1,000 characters and 12 entries, trial first), so they never crowd out the bot's own notes. The notes are frozen per chat; the block is rebuilt when the bot's lessons change (`lessonsRev`), at the cost of one prompt-cache miss.
- Tables `item_use` (which memory item or skill was in front of a reply: `shown`, `relevant`, `loaded` or `always`) and `reply_outcome` (one verdict per reply). Only `relevant` and `loaded` count; a lesson is `relevant` when its topic overlaps the message or the reply, or when it applies to every reply. A listed search hit that the bot never opened is not a use.
- A reply's verdict is a pure function of what was stored: a thumb down, a stop, a correction sent while the reply was written (`steered`) or a correction on the next message are bad; a thumb up, a done task, a carried-on chat or a pick in a paired test are good. A message that only adds to the request while the bot works says nothing against the reply (see `fluid-chat.md`). A restart is neutral, and so is a reply an older "Send now" cut off. A late rating judges the reply again.
- Search ranks with recency (down to 0.85) and what happened after the item was used (within plus or minus 10%), and hides an item that a current item replaces with a `supersedes` link. `score`, which orders the notes block, is never changed by usefulness.

## Check: the trial, the ranking and the tidy-up

- **Trial** (`learning:trial`): a lesson is kept after 5 judged uses with no bad one among the last 3, and dropped after 2 bad uses at 40% or more and clearly above the bot's usual rate. The owner can pick strict (8 clean, drop at the first bad) or loose (3 clean, drop at 3 bad). A kept lesson that goes bad (50% bad in its last 10 uses) is never dropped by itself: it becomes a suggestion.
- **Lessons page** (`/lessons`): every memory item, skill and lesson, labelled _helps_, _hurts_, _unclear_ or _unused_ against the bot's own rate of being stepped in on, with bulk archive and restore. Filters live in the address.
- **Tidy-up** (`learning:tidy`, once a week per person, no model): lessons that say the same (60% of their words in common), lessons that may pull in opposite directions (50% and opposite polarity), items that a current item replaces, items whose nearest stored passages are within 0.035 cosine distance (calibrated against real memory: real duplicates sat at 0.026 to 0.030, items only on the same subject from 0.048), items the person wrote that nothing used for 90 days, and a kept lesson that stopped helping. Everything is a **finding** the person accepts or dismisses; a dismissed one is never filed again and at most 30 wait at once.

## Forget

- **Daily forgetting** (`learning:forget`): a lesson on trial that nothing used for 30 days, or a kept one for 60, is archived with the reason written down and one notice. Skill-backed lessons are never archived this way (their use is not counted). Person-written items are never archived by Zetta: they become suggestions.
- Every drop and every restore is a `bot_lesson_event`, so a wrong drop can be traced and undone. Nothing is deleted.

## Prove a bot improved

- **Is it getting better?** on the Quality tab: step-ins per 100 judged replies for each of 12 weeks, the lessons that started, were kept or dropped beside them, and the last four weeks against the four before (needs 20 judged replies on a side, or it says so).
- **Compare without memory** on a saved test: the same question asked twice, once as the bot is and once without its notes, lessons, search hits, project notes, memory tool and the person's own skills (Zetta's built-in skills and the bot's agents stay). The person picks the better answer; the pick is the strongest signal there is (`chose_better` counts 3, `chose_worse` minus 3) on the reply that had the items.

## Both ways to run a check

- Server jobs do the work and report on the pages and in Catch up.
- Workflows have a `zetta` tool kind (target `lessons`: list, stats, keep, drop, restore, accept, reject). A write needs an approval step before it. **Add the weekly check to my workflows** creates an ordinary workflow of the person's own.
- The Chief has `zetta:lessons`; MCP has `list_lessons`, `get_lessons_progress` and `change_lessons` (write scope). See `bot-parity.md`.

## Settings

- The setting `lessonBatch` (Studio > Server settings) turns the daily reading on or off for the installation. The setting `lightRuns`, when on, runs the batch engine call without the host's plugins, skills and tools (`--setting-sources project --strict-mcp-config --disable-slash-commands --tools=`; never `--bare`, which reads only an API key and would break subscription logins). Measured on 2026-11-18 with `scripts/e2e/light-run-compare.ts` (3 runs each way, the daily reading prompt, Haiku): 45.9k tokens plain against 4.9k light (89% fewer), but only 75% of the candidates matched between the two sides, under the 80% bar. **The default stays off.** A person can turn it on for the installation if they accept that trade; the comparison is worth running again with more runs and a second machine.
- Per person (Lessons page and the bot's page): reading `daily` or `off`, forgetting `on` or `off`, tidy-up `weekly` or `off`, trial `strict`, `normal` or `loose`.

## Not done

- No training, no outside memory service, and no model judging whether an answer was good: only what the person did.
- Items that are always in the prompt (profile, notes) and reads by outside MCP clients cannot be measured, so they show as _unclear_ at best.
- A bot that someone else owns never feeds a batch, and its replies are not counted for its owner's lessons.
- The "without" side of a paired test uses the same fallback engine rules; a fallback harness may still load the person's skills on that side.
- The real-model run (`scripts/e2e/lessons-batch.ts`, 2026-11-18, one chat day with a rule said outright, a correction made in two chats and a passing remark) was green, but it is one small scenario: it says nothing yet about a month of real chats.
- The Chief cannot read the tidy-up suggestions or the weekly trend yet.
