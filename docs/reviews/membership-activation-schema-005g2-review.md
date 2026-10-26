# Coordinator offline membership activation schema review

Verdict: CLEAR for offline artifacts,2026-10-22. Root read schema/DDL/config/test changes and independently passed8tests/180assertions and strict TypeScript. Worker three-source LSP checks were clean. Pre-change/repeat generation reported no delta; baseline SQL/snapshot remained unchanged. Installed migration loading excludes the snapshot-only ancestor and returns exactly two new SQL features.

The delta adds only activation_revision integer DEFAULT1 NOT NULL and its positive int32 check. A separate null-safe guard requires insert1, immutable user identity, removed→active exact+1 and MAX exhaustion before arithmetic; other valid updates preserve revision. Existing status/removal/admin checks and timestamps remain. No repair, cross-table query/lock, role change, dynamic SQL or SECURITY DEFINER.

Reviewed SQL hashesfd479f854f62a49e47acbb8be281115c90903a412e3e79aa3ec263bdab36b723 and1bc761f3b0434ea4a0a67b20ec1198af7981b8a459383520ad67fd248fc1d714; schema1ab8a19bb8cc24037d67e5ba756af5955aedce9c65ff5527f767ee71bd2a9dff. Other pins and retained setup/test-only failures are in currentattempt/identity-005g2/.

Backfill1 establishes a new boundary, not legacy trust. Actual constraints/chain, lifecycle increments/rollback/exhaustion, nonowner permissions and removal/cancellation remain unproved. All old-lineage modes stay gated until005g3; run/dispatch additionally need009 provenance layering. Future lifecycle UPSERT must insert1 and put the checked next revision only in conflict UPDATE: BEFORE INSERT also runs for conflicting inserts.
