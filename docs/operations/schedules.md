# Schedule policy (RFC-038/039)

- A daily routine runs when the wall clock in its IANA timezone reads `HH:MM`; an interval routine runs every N real minutes; a one-time routine runs once.
- **DST gap** (the wall time does not exist that day): that day's occurrence is **skipped**, the next day runs normally. **DST fold** (the wall time occurs twice): it runs **once**, at the first occurrence.
- **Downtime:** after an outage only one catch-up occurrence runs; missed ones are not replayed.
- **Exactly-once:** each occurrence is claimed by inserting a unique `(routine_id, occurrence_key)` row (`sched:<instant>` or `manual:<requestKey>`) before it runs, so two workers or a crash/retry cannot repeat it. A run left `running` by a dead process becomes `interrupted` at boot and raises one attention card.
- **Admission at dispatch:** owner membership must be active and the bot ready (onboarded, accounts connected). Otherwise the occurrence is recorded as `blocked` (with a reason code), the routine is paused and one attention card explains what to fix.
- **Result:** every run produces a chat the owner can open (new per run, or continuing one chat), plus a history row with status, reason code and times.
- Tests: `features/wave.integration.test.ts` (gap/fold, two-worker race, owner inactive, interrupted recovery).
