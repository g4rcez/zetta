# Coordinator activation lifecycle review

Verdict: CLEAR for source, 2026-10-22. Root read both activation paths and their protocol controls, independently passed47 lifecycle/operator tests with1129 assertions and scoped strict TypeScript. Worker four-source diagnostics were clean; the bounded HTTP regression passed5 tests/74 assertions after its first sandbox listener denial. These tests do not establish actual PostgreSQL transactions.

Both paths read and validate the positive int32 revision under the existing membership locks. Fresh INSERT binds1; removed-to-active conflict UPDATE binds the checked next revision and requires removed status plus the prior revision. Missing-row conflict uses prior0 and fails closed. MAX/corrupt rows deny before invitation consumption or administrative writes; active MAX remains unchanged. The complete sorted account-before-membership order, singleton serialization, session drain and public opaque errors remain intact.

Actual migration/catalog compatibility, guarded lifecycle updates, concurrent activation, late rollback and exhaustion remain pending. The separate fixed pre-guard MAX fixture may initialize a synthetic exhausted row before the guard exists, but must return only after normal full verification. No live guard bypass, runtime role or removal/cancellation guarantee is accepted here.
