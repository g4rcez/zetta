# Improve useful work and make it repeatable

[Wiki home](../README.md) · [Glossary](../glossary.md)

> **Status: intended v1 journeys.** Learning, routines, and visual workflows are required; this guide does not claim their implementation is complete.

## Choose the right kind of change

| Your goal | Use | Example |
| --- | --- | --- |
| Correct a retained fact or preference | Memory | “My briefing timezone is Lisbon, not London.” |
| Keep a useful method | Reusable instruction | “Compare conflicting sources and include links.” |
| Change the bot's setup or behavior | Configuration | Change its model or assigned integration. Bot-proposed edits require explicit approval. |
| Run stable work at known times | Routine | Prepare the briefing each weekday. |
| Choose different steps based on conditions | Visual workflow | Summarize available sources; take a different branch when required sources are missing. |

A workflow describes the steps and conditions. A routine describes when a task or published workflow runs. Neither is a visual workspace, which only groups bots.

## Correct a mistake

1. Open the result and inspect the recorded knowledge sources, when available. Zetta must not invent an explanation of why the model answered incorrectly.
2. Correct or forget the relevant memory, or open the reusable instruction and update its method.
3. Return to the original result. The historical answer stays unchanged.
4. In a later task, check that the corrected knowledge is selected and forgotten knowledge is excluded from retrieval.

A better-sounding answer is not enough to prove the correction was used. Forgetting a memory is also not a promise to erase historical messages or published snapshots. Retention and deletion rules need an explicit implementation decision.

Learning can retain scoped facts and procedures without asking for approval on every ordinary learning event. It must not silently change bot configuration or promote your private knowledge to shared use. A learning receipt should explain what was retained and link to inspection, correction, or deletion.

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

Use the visual editor or its accessible form/list alternative to describe bot tasks and conditions. Review which path runs for each outcome, then publish a version and test deliberately. Editing a draft must not silently change a published graph or a running execution.

The initial graph catalog is a technical proposal awaiting acceptance, not full n8n parity. Inspect which steps completed, failed, were blocked, or were skipped by a branch. Workflow blockers use the same [attention and repair path](work-and-attention.md) as chat and routine work. Restart must not replay uncertain external actions.

## Implementation owners

[Memory correction: RFC-058](../../../tasks/058-inspect-correct-and-forget-memories.md), [instruction library: RFC-059](../../../tasks/059-build-versioned-instruction-library.md), [learning: RFC-061](../../../tasks/061-learn-reusable-procedures-after-tasks.md), [configuration approval: RFC-063](../../../tasks/063-apply-only-explicitly-approved-versions.md), [routine editor: RFC-040](../../../tasks/040-build-routine-calendar-and-editor.md), and [workflow graph](../../../tasks/079-define-versioned-conditional-workflow-graphs.md), [execution](../../../tasks/080-execute-durable-workflow-steps.md), [editor](../../../tasks/081-build-visual-workflow-editor.md), and [inspection](../../../tasks/082-inspect-workflow-progress-and-repair-paths.md).
