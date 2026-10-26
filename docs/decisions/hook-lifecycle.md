# Hook lifecycle (RFC-051/052)

Hooks belong to a bot (configured by its owner) and run in `chat/pipeline.ts` before each model call, in this fixed order:

1. Hooks are sorted by `position`, then creation time. Disabled hooks are skipped.
2. `redact` hooks replace matches in the new message **and in the history that will be sent**, so a secret sent earlier never returns in a later prompt.
3. `stop` hooks are evaluated on the **redacted** text; a match ends the turn with the hook's message and **no model call**.
4. `add_context` hooks add their text to the prompt. `background` hooks start one owned background run *after* the reply; the result lands in the owner's attention list. A retried send (same `clientRequestId`) replays the stored turn and does not re-fire background hooks.

Safety: patterns are validated at save time and again at run time (`features/safety.ts`): ≤100 chars, no nested/quantified groups, alternation under quantifiers, backreferences or lookarounds, input capped at 20 000 chars. Invalid or risky patterns are rejected on save (400) and, if found at run time, skipped with an attention card. Budgets: ≤20 hooks per bot. Hook configuration is visible and editable by the bot owner only; its *effect* applies to every user of a shared bot (it is bot behaviour). `POST /api/bots/:id/hooks/dry-run` previews the transformation without calling a model.
