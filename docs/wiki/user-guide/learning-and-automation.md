# Improve useful work and make it repeatable

[Wiki home](../README.md) · [Glossary](../glossary.md)

## Choose the right kind of change

| Your goal                                  | Use                                     | Example                                                                                 |
| ------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Correct a retained fact or preference      | Memory item (a note, or tagged profile) | “My briefing timezone is Lisbon, not London.”                                           |
| Keep a useful method                       | Memory item tagged instruction          | “Compare conflicting sources and include links.”                                        |
| Change the bot's setup or behavior         | Configuration                           | Change its model or assigned integration. Bot-proposed edits require explicit approval. |
| Run stable work at known times             | Routine                                 | Prepare the briefing each weekday.                                                      |
| Choose different steps based on conditions | Visual workflow                         | Summarize available sources; take a different branch when required sources are missing. |

A workflow describes the steps and conditions. A routine describes when a task or published workflow runs. Neither is a visual folder, which only groups bots.

## Correct a mistake

1. Open the result and inspect the recorded knowledge sources, when available. Zetta does not invent an explanation of why the model answered incorrectly.
2. Open the memory item the answer used (the notes under the answer link to it) and correct it, archive it, or update the method it describes.
3. Return to the original result. The historical answer stays unchanged.
4. In a later task, check that the corrected knowledge is selected and forgotten knowledge is excluded from retrieval.

A better-sounding answer is not enough to prove the correction was used. Forgetting a memory is also not a promise to erase historical messages or published snapshots.

Learning can retain scoped facts and procedures without asking for approval on every ordinary learning event. It never silently changes bot configuration or promotes your private knowledge to shared use. A learning receipt explains what was retained and links to inspection, correction, or deletion.

## What your bots learn, and how to keep only what helps

Once a day Zetta reads a bot's chats with you and looks for things worth remembering. A single message never teaches a bot: a lesson needs your own words behind it (Zetta checks that the quote is really in a message you wrote, never in a web page, a file or another bot), and it must either be said outright ("from now on", "always", "nunca") or show up in two chats or on two days. A lesson is one short sentence, kept as a small memory item.

A new lesson goes **on trial**: the bot follows it at once, and Zetta watches what happens after the replies that used it. If you did not have to step in (stop, redirect, correct or rate down), it is kept after a handful of uses. If you did, it is dropped. Dropping archives the lesson: nothing is deleted, and you can bring it back.

- **Lessons** (sidebar) ranks every memory item and skill by what happened after it was used (helps, hurts, unclear, unused), next to how often you step in for that bot. Select the ones not worth keeping and archive them together.
- **Suggestions** (a tab of the same page) is the weekly tidy-up: lessons that repeat or pull against each other, items a newer one replaced, items nobody used for months. It only suggests. Nothing changes until you accept, and a dismissed suggestion does not come back.
- **What I learned** (the bot's settings, Skills and learning) lists the lessons of one bot and why each exists, with **Run now** to read today's chats on the spot. Turn the daily reading, the automatic forgetting or the tidy-up off for yourself there.
- **Is it getting better?** (the bot's Quality tab) draws how often you stepped in, week by week, with the lessons that started, were kept or dropped. **Compare without memory** on a saved test asks the same question once as the bot is and once without its memory and skills, side by side: your pick counts for or against what the bot knows.
- A lesson check can run as a workflow: **Add the weekly check to my workflows** on the Lessons page. It asks your Chief which lessons to drop and waits for your yes.

A bot never rewrites a memory item by itself. When it wants to replace one, you get a suggestion to accept.

## Turn a successful task into a routine

Start from a successful task or a reusable instruction. Keep the method, not an accidental copy of yesterday's source data or secrets. Configure through forms or an authorized bot conversation, then inspect the same draft and validation results.

Before activation, understand:

- The task or published workflow and the responsible bot or bots.
- Which of your accounts it uses.
- Schedule, timezone, and next occurrence.
- How fresh inputs and conversation context are selected.
- Where results appear.
- What happens if an occurrence is missed or overlaps another.

Saving a draft is not activation. Missing onboarding or account access blocks activation. A labeled test run performs real work; it is not necessarily an effect-free preview. After the first occurrence, open its actual result from history instead of relying only on a success label.

## Add conditions with a visual workflow

Use the visual editor or its accessible form/list alternative to describe bot tasks and conditions. Review which path runs for each outcome, then publish a version and test deliberately. Editing a draft does not change a published graph or a running execution.

The catalog of steps is small on purpose; it is not full n8n parity. Inspect which steps completed, failed, were blocked, or were skipped by a branch. Workflow blockers use the same [attention and repair path](work-and-attention.md) as chat and routine work. A restart does not replay uncertain external actions.
