# Workflows that wait, ask, loop and call tools

Decided and built on 2026-11-15. Before: six steps (prompt, condition, decision, browse, sources, end), one after the other, at most 20, a run that blocked its request to the end.

## New steps (`features/workflow.ts`)

| Step                                                           | What it does                                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approval {message}`                                           | Stops the run and raises a card in the Inbox. Approve goes on; Decline or an expired card cancels the run.                                                      |
| `wait {seconds \| until}`                                      | Pauses for up to 7 days, or until a time.                                                                                                                       |
| `for_each {items: lines \| json, body, max}`                   | Runs the body once per item (at most 20). The body is a chain that ends at `item_end`; `{{item}}` is the item; the numbered answers become the previous answer. |
| `item_end`                                                     | The last step of one pass.                                                                                                                                      |
| `tool {botId, kind: plugin \| mcp \| app, target, tool, args}` | Calls one tool with the grants of the named bot, as the owner.                                                                                                  |
| `retry {max ≤ 3, delayMs}` on prompt, browse, sources and tool | More tries after a failure a second try can fix. Not for a sign-in, a limit, a bot that is not ready, a choice nobody could make.                               |

More: up to 30 steps and 100 executed steps; `{{steps.<id>}}` is the answer of an earlier step; placeholders are filled in one pass, so an answer that contains `{{prev}}` is never filled again.

## Rules the graph must keep (checked when saved)

- A loop body holds only plain steps: no `end`, `approval`, `wait` or loop, and it is reached only through its loop.
- A `tool` step that **may change something** must come straight after an `approval` step (every way into it). A plugin tool counts as a change unless its definition says `read`; an app tool unless its kind is `query`; an MCP tool always. The person says yes to that step with the next step shown on the card.
- A `tool` step names a bot the owner may use, like a prompt step.

## Waiting runs

- `workflow_run` gained status `waiting`, `input`, `cursor`, `resume_at`, `pending_proposal_id`, `routine_run_id` (additive migration `20261115225041_workflow_waiting_runs`).
- A run answers at its first pause or at its end. Its state is the cursor (`at`, the previous answer, the step count, the answers by step), so a restart loses nothing: `recoverInterrupted` only touches `running` rows.
- A `workflows:resume` job on the 30-second ticker wakes runs whose time came, and runs whose card was decided. Each is claimed by a conditional update before it runs. A person's paused agents keep their runs waiting; a decline or an expiry still goes through.
- The approval card is a `chief_action` with tool `workflow_gate`; approving it changes nothing by itself (the run reads the card's status on the next tick, so up to 30 seconds). It is never remembered by "Always allow".
- "Stop this run" (`POST /api/workflow-runs/:id/cancel`) closes the card with it. A routine whose workflow pauses counts as done.
- `modules/runtime/*` (the durable-run tables) was **not** used: it models bot runs with leases and fencing and is not wired.

## Not done

- A wait for an event (a message, a webhook): time only.
- Writes inside a loop body (they need an approval step, which a body cannot hold).
- Several approvals in parallel branches, a run started by a trigger with structured input (the event still arrives as text), the `routine_run_id` link (the column exists, routines do not fill it yet).
- The linear step builder stays read-only for graphs it cannot round-trip (all graphs with the new steps); the canvas edits them.
