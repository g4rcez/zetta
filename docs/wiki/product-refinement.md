# Product refinement: useful work without technical administration

[Wiki home](README.md)

> **Status:** review of the confirmed v1 direction, not user-research evidence or a scope change. The user approved a journey-first repository wiki with separate user and architecture sections. The validation exercises below are proposed and have not been run.

## Problem statement

How might we help a nontechnical user get useful work from autonomous bots, understand what happened, and recover when help is needed—without making them administer the underlying execution tools?

The primary reader is a person managing their own bot work. Developers and implementation agents are a second audience with different information needs. Success means the user can complete a meaningful task, find its result, fix a blocker, and safely repeat useful work—not merely save a bot configuration.

## Alternatives considered

These are ways to organize the experience and its documentation, not competing v1 feature lists.

| Lens and variation | What it offers | Why it is not sufficient alone |
| --- | --- | --- |
| Catalog-first: explain every feature and setting | Complete reference material | Makes the reader assemble the journey and learn internal terms first. |
| Simplification: explain everything through chat | A familiar way to state goals | Chat alone hides state and comparison; it would contradict required forms and visual controls. |
| Journey-first: start from the user's job | Connects setup, execution, results, and repair | Needs a concise reference layer for ownership rules and advanced concepts. |
| Inversion: start with work needing attention | Helps a returning user decide what to do next | Does not explain first-time setup or successful work that needs no intervention. |
| Expert lens: lead with contracts and evidence | Helps developers avoid unsafe or speculative integrations | Excludes the nontechnical user if used as the main guide. |

## Evaluate and converge

| Direction | User value | Feasibility and risk | Differentiation hypothesis |
| --- | --- | --- | --- |
| A. Feature reference | Useful after the user knows what to look for | Simple to write, but tends to duplicate RFCs and drift | Low; a larger manual is not a reason to switch products. |
| B. Journeys with attention and recovery | Directly supports getting work done and returning after failure | Requires coherent transitions across existing modules; a wiki cannot fix a broken UI | Potentially meaningful: less supervision and less recovery work, not more supported tools. |
| C. Architecture and decision handbook | High value for implementation quality | Requires honest gaps and source-backed compatibility decisions | Supports trust, but is not the end user's main benefit. |

## Recommended direction

Use **B as the primary guide, supported by C and a small glossary**. Explain one useful bot first, then delegation and attention, learning and repetition, sharing, and browser/computer work. Preserve direct chat, forms, advanced settings, and all required v1 capabilities. Do not force every user through the whole feature catalog before their first useful task.

The existing documents provide a coherent scope and dependency plan. They do not yet prove usability or real integration support. The strongest product hypothesis is that Zetta reduces the user's coordination and recovery effort. Six harnesses are a compatibility commitment, not evidence of that benefit. More documentation is worthwhile only if it clarifies decisions and next actions rather than creating another source of truth.

## Key assumptions to validate

All rows remain **unvalidated**. The RFC links identify where evidence belongs; they do not add a new status tracker.

| Assumption and importance | Proposed check | Evidence owner |
| --- | --- | --- |
| **Must:** a nontechnical user can reach a useful first response without understanding harness internals | Observe a representative user configure, converse, reject an unsatisfactory result, refine, and confirm. Record help required and whether the user can explain what is ready. | [RFC-021](../../tasks/021-build-bot-onboarding-and-settings.md), [RFC-067](../../tasks/067-verify-representative-v1-user-workflows.md) |
| **Must:** isolated execution works with the required tools | Prove two-user isolation and real compatibility, including both browser and desktop paths. A fixture cannot close this risk. | [RFC-002](../../tasks/002-prove-multi-user-execution-isolation.md), [RFC-066](../../tasks/066-verify-cross-user-isolation-end-to-end.md), [RFC-068](../../tasks/068-gate-release-on-real-compatibility-and-readiness.md) |
| **Must:** users understand partial results and uncertain external effects | Present one successful specialist and one blocked specialist. Ask what completed, what might have happened, and what a new attempt could repeat. | [RFC-037](../../tasks/037-aggregate-bounded-specialist-work.md), [RFC-072](../../tasks/072-build-user-attention-kanban.md) |
| **Should:** explicit per-bot onboarding stays useful rather than repetitive | Observe a second specialist setup and a meaningful configuration change. Record repeated effort and mistaken assumptions about readiness. Define which changes need retesting without weakening consent or isolation. | [RFC-020](../../tasks/020-implement-versioned-bot-configuration.md), [RFC-021](../../tasks/021-build-bot-onboarding-and-settings.md) |
| **Should:** forms and chat are equally understandable | Have a user perform comparable edits by form and through a non-chief bot. Check the target, diff, approval, and resulting version—not just natural-language fluency. | [RFC-073](../../tasks/073-configure-resources-through-any-bot-chat.md) |
| **Should:** users can choose a routine versus a workflow | Ask them to repeat a stable task, then add a conditional branch. Check that they can explain when work runs and which steps run. | [RFC-040](../../tasks/040-build-routine-calendar-and-editor.md), [RFC-081](../../tasks/081-build-visual-workflow-editor.md) |
| **Should:** learning improves later work without hiding errors | Correct a recorded fact/procedure and inspect later retrieved context. Do not infer causation from a better-sounding answer alone. | [RFC-058](../../tasks/058-inspect-correct-and-forget-memories.md), [RFC-061](../../tasks/061-learn-reusable-procedures-after-tasks.md) |
| **Must:** users understand whole-conversation publication | Ask what a teammate will see before publication: the full frozen conversation, not merely the latest answer and not the underlying accounts. | [RFC-034](../../tasks/034-capture-immutable-conversation-snapshots.md), [RFC-067](../../tasks/067-verify-representative-v1-user-workflows.md) |

## MVP scope for validation, not a smaller v1 release

Start with one proposed learning exercise: prepare a daily briefing from approved synthetic sources, encounter an expired connection, repair it, return to retained results, correct a fact, and turn the stable method into a routine. Try configuration through a form and through bot chat. Observe where users need help; do not invent numerical success thresholds before agreeing on the study.

This exercise tests the core journey early. It does **not** replace the full [RFC-067 acceptance matrix](../../tasks/067-verify-representative-v1-user-workflows.md), six-harness evidence, visual workflow tests, or real browser and desktop proofs. Required capabilities remain release gates. Any environment-dependent study needs separate approval.

## Not doing and why

- Reopening confirmed v1 scope — the user asked to preserve it and expose risks instead.
- Treating task count as delivery evidence — a valid backlog is not a working product.
- A second copy of RFC status, schemas, or API contracts — duplicated authorities drift.
- Chat-only configuration — explicit forms and visible state remain important.
- A hosted wiki, new documentation stack, or public publication — repository Markdown is enough for this task.
- Marketplace, team-map canvas, external notifications, or configurable per-action permissions — these remain deferred by confirmed intent, not by this review.

## Open questions and failure signals

The owner still needs to identify representative nontechnical users and their current workarounds; decide acceptable setup/recovery effort; and agree on meaningful readiness-invalidating changes through the owning RFC. Integration owners still need evidence for the named tools and isolation model.

If users need technical coaching for every setup, cannot tell which actions may repeat, or cannot understand what a snapshot shares, the experience has failed even if the underlying services pass tests. If a required runtime cannot satisfy isolation, release is blocked. Neither failure should be hidden by adding more wiki pages.
