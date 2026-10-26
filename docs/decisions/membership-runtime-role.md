# Membership runtime role and retention proof

Status: source proposal005g6; not a deployed role or an executed permission proof. Actual execution additionally requires accepted current run-provenance lineage. Root reported the initial normal run-schema setup failed and is diagnosing that separately; no bypass of that gate belongs here.

## Boundary

The accepted activation revision cannot be reset by deleting/reinserting membership through the runtime role. Owner/migration access remains privileged TCB. This fixture starts only through `openRunProof` on its fresh fixed disposable target, preserving the accepted baseline, activation, connection, run and producer migrations and their pins. It adds no schema migration or production role setup. No other adapter or launcher changes are included.

The fixture creates `zetta_membership_runtime_proof` with a random32-byte hex password, LOGIN, NOSUPERUSER, NOINHERIT, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. There are no role memberships. A separate pg Pool authenticates directly with those credentials and reserves one client. Both session_user and current_user must match that fixed role. The owner verifies the exact runtime backend PID/database/application and its own advisory40042/2 lock; the runtime verifies database, owner, marker and PostgreSQL18 version. It receives no pg_read_all_settings permission. Four clients are reserved before sticky new-I/O denial. Credentials are neither returned nor passed through environment/argv/logging; the byte buffer is cleared, while the private driver retains what it needs until drained close and whole-service teardown.

Using SET ROLE from an owner connection would not prove this boundary: escalation checks still depend on session/initial identity. The fixture therefore uses a genuine separate LOGIN session. [PostgreSQL18 SET ROLE](https://www.postgresql.org/docs/18/sql-set-role.html).

## Fixed grants

Only this disposable database has PUBLIC database/schema/table/function privileges revoked. The new role receives CONNECT on this database and USAGE on public. No grant options are supplied.

| Object | SELECT | INSERT | UPDATE |
| --- | --- | --- | --- |
| user | id,email | none | updated_at |
| membership | all columns | all columns | activation_revision,status,removed_at,updated_at |
| installation_identity | all columns | none | id |
| invitation | all columns | none | consumed_at,consumed_by_user_id |
| identity_audit | none | all columns | none |
| runs | all columns | all columns | revision |
| run_attempts | all columns | all columns | status |
| Remaining8 public tables | none | none | none |

The otherwise unused updated_at/id/revision/status UPDATE grants enable actual SELECT FOR UPDATE and deferred trigger locks; they do not authorize identity changes. PostgreSQL requires UPDATE on at least one column as well as SELECT for row locking. Database TEMP and function EXECUTE have PUBLIC defaults, so effective checks must include PUBLIC rather than inspecting only a role's ACL entry. [PostgreSQL18 privileges](https://www.postgresql.org/docs/18/ddl-priv.html).

These are minimal grants for the two demonstrated services, not all application capabilities. The fixture intentionally cannot issue invitations, replace admins, remove sessions or complete runs through this role. Invitation issuance/admin bootstrap are trusted owner-side fixture setup. Raw SQL permitted by these DML grants is not equivalent to actor authorization: the application services still enforce ownership and state. Neither row-level security nor compromised-runtime isolation between actors is claimed.

The catalog oracle checks exact role attributes, no membership edges, no object ownership, no CREATE on any schema, no database CREATE/TEMP, no destructive table privileges, no public function EXECUTE, no replication parameter privilege and no column grant options. Every column's effective SELECT/INSERT/UPDATE/REFERENCES is compared against the fixed matrix across the verified15 tables. Membership paths can otherwise provide inherited privileges or permission to SET ROLE; NOINHERIT alone is insufficient. [PostgreSQL18 role membership](https://www.postgresql.org/docs/18/role-membership.html).

## Actual proof proposal

Future reviewed launcher invocation must start a fresh owned tmpfs service and execute `bun --no-env-file apps/server/src/modules/identity/membership-role.integration.ts` with no additional arguments.120s covers setup, tests and drained close; existing2s lock/4s statement/5s query bounds stay unchanged. No currently authorized execution or launcher mode is implied.

1. Owner seeds a removed revision1 member and a distinct admin, bootstraps through the actual service and issues an invitation. Restricted actual reenrollment must reach revision2 and preserve original joined time. A controlled session source plus real membership lookup issues the actor; no HTTP/signin claim.
2. Restricted actual run submission and replay/read succeed. The persisted fixture producer/version/activation stamp is exact and the deferred current-attempt check commits under restricted permissions.
3. Owner deletion of that member fails23001 with exact `runs_owner_user_id_membership_user_id_fkey` RESTRICT identity. Its run retains the prior enrollment stamp after later reenrollment. This demonstrates the current run FK, not a future readiness FK.
4. Seventeen runtime operations each fail exact42501: membership DELETE/TRUNCATE/identity UPDATE; user identity UPDATE; run/attempt DELETE; ALTER/DROP; trigger disable; guard-function replacement; schema/public-table/temp-table creation; SET ROLE owner; SET SESSION AUTHORIZATION owner; self-SUPERUSER; session_replication_role bypass. Each runs inside a rolled-back transaction. All15 tables are privately compared before/after, and effective role/catalog checks rerun after each denial. No private state or SQL errors are logged.
5. A fixed owner-created attempt-insert rejection trigger is intended to prove rollback of the preceding restricted run insert. Its new function has all PUBLIC privileges revoked immediately after creation/trigger setup; the effective runtime profile is verified again before submission. Actual execution must establish that the trigger still fires with exact23514 under this no-EXECUTE profile; source review does not assume success. A temporary observer forwards the actual runtime driver's query/result/error unchanged, records only that exact23514/fixture constraint was seen, and is restored. The service must return its existing outcome_unknown boundary; complete state remains unchanged. Drop only that fixture trigger/function, then require another actual run submission and another reenrollment success. No public guard is disabled or replaced.

Expected output:20 fixed scenario PASS lines plus one idle/zero-I/O/drained-close line, all after close. The launcher must separately prove exact container/network teardown. No SQL fixture deletion, privilege-restoration/reset or role reuse is offered. The entire owned service destroys the role/password and retained rows.

## Deployment gate

This is an isolated proof profile, not a production privilege migration. Deployment must provision a nonowner service LOGIN separately from migration/operator credentials, revoke inherited/PUBLIC escalation paths, apply reviewed granular grants for each supported service, and verify effective privileges on startup and after migrations. New objects/default ACLs/functions require renewed review; owner-created SECURITY DEFINER routines cannot silently supply a bypass. Auth provisioning and additional mutation services need separate grants and real permission tests. The privileged operator can still alter schema/data and remains TCB. Runtime retention/readiness/dispatch claims remain gated until this actual proof and deployment confinement are accepted; source tests alone grant no execution eligibility.
