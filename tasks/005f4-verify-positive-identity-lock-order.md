# RFC-005f4: Verify corrected identity lock order

Status: accepted after [coordinator actual six-direction proof](../docs/reviews/identity-lock-order-005f4-review.md),2026-10-22. Root71934 passed/exit0 with exact dedicated cleanup. Historical005f2 reproduction files remain frozen.

Own new identity/identity-lock-positive.integration.ts, its focused test, identity-lock-positive-cases.ts, identity-lock-session-case.ts and identity-lock-enrollment-case.ts. Reuse verified openConnectionProof with three reserved clients, sticky new-I/O guards, closed target validation and existing strict timeout bounds. No schema/proof-client/product-service changes. Root owns the launcher and exact disposable service lifecycle.

Required actual scenarios:

- Connection first: pause after its real membership query while retaining the new auth KEY SHARE. Actual admin replacement must wait at auth B, before member B; release, both succeed once with coherent connection/admin/audit/session state and no deadlock.
- Replacement first: pause after actual sorted account/member acquisition. Connection must wait at its account prelock; release, both succeed once and preserve unrelated state.
- Session insertion first: an actual uncommitted synthetic session FK holder precedes actual replacement. Observe replacement's account wait; commit session, replacement deletes affected A/B sessions including the just-committed row. Unrelated C remains.
- Replacement first/session insertion: prove the new session FK insertion waits behind the unchanged administrative FOR UPDATE fence, then succeeds only after replacement commits. Old affected sessions are deleted; the later new session remains. This is the existing session boundary, not a claim to prevent future sign-ins.
- Sorted multi-member control: clearly labeled synthetic future020 transaction takes the complete sorted account KEY SHARE set before sorted memberships, with target B sorting before admin A. Actual enrollment acceptance of an already-active B must wait at the account prelude, then deny without consuming the invitation or changing membership/audits. Both ordering directions must settle without opposing waits. This proves the shared order against an actual enrollment path, not a nonexistent020 service.

Use independent reserved clients and observed pg_blocking_pids plus completed real-query stage traces. No sleep, stubbed row, timeout/error accepted as success or relaxed DB settings. Bound every pause and wait, await all service/query promises, restore hooks, verify idle backends/zero forbidden attempts and close clients before success. Require exact committed-state readback, session scope and no captured40P01/55P03/57014. Guards fail before timers/I/O in fresh-process tests. No DB/container/VM/provider/install/Git operations in source preparation; exact whole tmpfs-service teardown remains the root launcher's responsibility.
