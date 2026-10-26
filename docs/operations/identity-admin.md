# Existing-account installation admin command (RFC-004e2)

**Source accepted after independent review; the disposable CLI proof now passes six checks.** See [004e3 evidence](../../tasks/004e3-verify-existing-account-admin-command.md). RFC-004/004e remain incomplete. Production execution, credential provisioning and public routes require their separate gates.

## Authority and prerequisites

This is a local trusted installation-operator tool, not an authenticated HTTP API. Authority comes from protected OS execution and DB access. Neither an input field, the action name nor an acknowledgement string authenticates an operator. Do not expose it to application users or a public route/job runner, and do not grant them operator environment or filesystem access.

Before a future approved execution:

1. Independently approve the actual destination and intended operation. A loopback address may be an SSH tunnel to another server; URL validation and database/user readback do **not** prove a disposable or nonproduction target. No production execution is approved in this slice.
2. Apply the separately approved identity schema beforehand. This client never migrates, creates, resets, truncates or discovers schema. Use the minimum approved operator DB privileges for the existing lifecycle transactions.
3. Through an approved trusted inspection procedure, identify the exact already-provisioned account IDs, current singleton/admin state and (for replacement) expected old admin. Never choose the first signup or guess an ID. This command does not create a user, credential or password.
4. Protect environment and stdin from other users, shell tracing/history, logs and source control. Supply URL credentials through the approved private process environment, not command-line flags. Do not place real IDs or secrets in checked-in examples. Ensure the input producer closes its pipe; interactive TTY input is rejected.

## Executable and target contract

From the repository root, the executable is:

```text
bun --no-env-file apps/server/src/modules/identity/admin-operator-cli.ts --help
bun --no-env-file apps/server/src/modules/identity/admin-operator-cli.ts bootstrap < protected-bootstrap.json
bun --no-env-file apps/server/src/modules/identity/admin-operator-cli.ts replace < protected-replacement.json
```

The latter two lines are **future approved execution syntax, not commands run as evidence here**. The named protected files are placeholders for privately supplied input, not repository artifacts. `--help` is static/offline. No flags or additional arguments are accepted for either action; IDs, credentials, authority claims and reasons are never argv options.

Both environment values are mandatory:

- `ZETTA_OPERATOR_DATABASE_URL`: an explicit `postgres://` or `postgresql://` URL with one nonempty username, password and database path. No `DATABASE_URL` fallback, app environment loading or automatic dotenv occurs. App `DATABASE_URL` is intentionally irrelevant, not a protection against targeting the same installation. Actually selecting an application DB needs future explicit target approval.
- `ZETTA_OPERATOR_ALLOW_MUTATION`: exactly `identity-admin`. This acknowledgement is not authentication or target approval.

The first command only permits lowercase `localhost`, canonical dotted decimal `127.0.0.0/8` loopback or `[::1]`, with an optional canonical decimal port 1–65535. Omitted port becomes the explicit effective port 5432. The driver receives unbracketed `::1`. Other hosts, sockets, host lists, shorthand/normalized IP spellings, leading-zero ports, query/fragment, multiple/empty database paths, dot paths, whitespace/control tricks, noncanonical/double percent escapes and encoded path separators are rejected. Components use canonical `encodeURIComponent` encoding where needed; decoded components cannot contain controls, percent signs or path separators. There is no remote TLS policy in this slice: driver SSL is explicitly disabled for the approved local/trusted-tunnel transport.

**Any present environment key matching `/^PG/i`, even with an empty value, or `NODE_PG_FORCE_NATIVE` denies execution.** This includes service/password files, SSL, connection options and ambient target defaults. Use a deliberately prepared environment; the command never silently removes or substitutes these settings.

Args/target/TTY checks precede stdin and the command timer. Complete input validation precedes dynamic DB/lifecycle imports and any Pool construction. Importing the CLI, pure dispatcher or DB client does not execute the command, create a Pool, initialize auth or open a connection.

## Private stdin contract

Exactly one JSON object, maximum **4096 UTF-8 bytes including whitespace**, closed by EOF. The streaming reader bounds bytes before accumulation, uses fatal UTF-8 decoding (split multibyte sequences work), rejects malformed/truncated encoding and cancels/releases the reader on errors or abort. No prompting, echo or credential input exists.

Bootstrap, synthetic example only:

```json
{"userId":"synthetic-existing-account"}
```

Replacement, synthetic example only:

```json
{"expectedAdminUserId":"synthetic-old-admin","newAdminUserId":"synthetic-existing-account","reason":"planned-transfer"}
```

Only those exact keys are accepted. IDs are exact, nonempty, already trimmed strings without C0/C1/DEL controls; old/new IDs must differ. Do not silently normalize IDs. Replacement reason is exactly `admin-unavailable` or `planned-transfer`; no freeform explanation, private information, credential, token or password is accepted. The CLI narrows the accepted lifecycle service's general nonblank-reason contract without changing that service.

## Effects and output

The command invokes exactly one accepted lifecycle method for existing accounts:

- `bootstrapExistingAccount({userId})`: active membership, unique singleton pointer and operator audit commit atomically. Existing/repeated bootstrap is unavailable, never automatic promotion. The disposable CLI proof verifies one winner from two independently blocked commands without orphan membership/audit.
- `replaceAdminWithExistingAccount({expectedAdminUserId,newAdminUserId,reason})`: singleton-first locking and expected-old check, target activation, pointer change, deletion of stored sessions for both users, operator audit in one transaction. Old admin stays an ordinary active member. Private resources are not transferred; schedules/readiness are not resumed. SQL session deletion alone is not proof of effective Better Auth cookie/cache revocation.

There is one owned pool (max 1) and one reserved backend. Fixed parameterized readback requires the selected database/current user/session user before the service is exposed. The client uses explicit host/port/database/user/password, SSL negotiation, UTF-8, public search path and application name; no URL is forwarded to pg and Drizzle logging is disabled. Client/pool error events set a persistent unhealthy flag without logging driver errors. The client end observer is installed before reservation. Idempotent close waits for both pool shutdown and reserved-client termination, including an already-observed end, without short-circuiting that wait on shutdown rejection. Persistent error flags are checked after close. Initialization failure also attempts cleanup.

Bounds: **20 seconds hard process deadline**, including stdin, imports, connection, operation and cleanup; 3-second connection timeout, 4-second server statement timeout, 2-second server lock timeout, 5-second query and idle-in-transaction limits. No blind retries. At the hard deadline the process exits even if an operation or cleanup is stuck; cleanup cannot be promised complete after forced termination.

- Exit 0: stdout exactly `Admin operator completed.` only after the lifecycle promise resolves (commit), health check, successful client close and final health check. No returned ID, reason or credential is printed.
- Exit 1: stderr only a fixed phase label `Admin operator unavailable (configuration|input|connection|operation|cleanup|deadline).` The actual emitted label contains one phase, not the alternatives. No driver error/cause, SQL parameters, URL, stdin, IDs or reason is logged. A preceding operation failure retains its phase if cleanup also fails.
- `--help`: exit 0 with static usage, without environment validation, stdin, timer or client startup.

## Failure and reconciliation — never blind retry

A failure is **not** a guarantee of rollback. A lost commit response, unhealthy connection, successful commit followed by close failure, or hard deadline can leave a committed mutation despite exit 1 and no success label. Stop. Through a separately approved trusted inspection procedure, inspect singleton pointer, selected accounts/memberships, audit and session state before deciding what to do next. Do not rerun bootstrap/replacement automatically, invent a rollback claim, or change the expected-old ID to bypass reconciliation. The stale expected-old check is deliberate. Do not print sensitive inspection results into ordinary logs.

## Evidence and remaining gates

See [RFC-004e2](../../tasks/004e2-run-existing-account-admin-command.md) for exact offline commands. Tests use injected service/open/IO boundaries, bounded stream fixtures, pure driver options, source inspection and fresh fail-closed subprocesses. They prove source behavior, not an actual CLI SQL transaction, trusted operator authenticity, effective operator credentials, physical rollback, locks/concurrency, invitation serialization or live session revocation.

The user's checkpoint continuation ran `bash scripts/verify-identity-auth.sh operator` on a fresh verified dedicated instance. All six checks and scoped teardown passed with exit 0. No argument still selects the separate auth proof, which was not rerun. New CLI evidence covers denials, selected-account bootstrap, stale/repeated denial, audit-failure rollback, membership/session-row scope and a two-process bootstrap race. This new proof has coordinator source review; it has not received a new independent review.

Synthetic user/session rows are not credential or login evidence. Effective cookie/cache revocation, invitation coordination and connected access gates remain. Credential provisioning is a separate unimplemented gate: installed Better Auth's admin-plugin `createUser` is not available in the current factory's empty plugin configuration and would need separately reviewed plugin/schema/auth composition. Do not add a plugin, guessed password hash or credential INSERT to make this command provision accounts. Parent RFC-004/004e stay incomplete.

## New-credential operator command (RFC-004e6)

The separate `credential-operator-cli.ts` composes supported private credential provisioning with the existing admin lifecycle. Source/offline checks and the six-case disposable valid-target proof passed, including an independent coordinator repetition. See [004e7](../../tasks/004e7-verify-credential-admin-command.md) for evidence and limits. The selected-existing-account command above remains available unchanged.

```text
bun --no-env-file apps/server/src/modules/identity/credential-operator-cli.ts --help
bun --no-env-file apps/server/src/modules/identity/credential-operator-cli.ts bootstrap < protected-new-admin.json
bun --no-env-file apps/server/src/modules/identity/credential-operator-cli.ts replace < protected-new-replacement.json
```

Only `bootstrap` or `replace` is accepted, with no extra arguments. Use the same approved target/environment and protected OS/DB authority described above. Additionally, any present `BETTER_AUTH_TELEMETRY*` environment key (case insensitive, including an empty value) denies before driver/auth import: the installed library can enable telemetry through environment despite option `enabled:false`.

Supply closed JSON on non-TTY stdin, at most 4096 UTF-8 bytes, and close the pipe. Bootstrap contains exactly `{name,email,password}`. Replacement contains exactly `{expectedAdminUserId,name,email,password,reason}`. Name is trimmed and must be 1–200 characters; email must be valid and at most 254 characters; password must be 8–128 characters. Expected admin ID is exact, nonempty, trimmed and control-free. Reason is exactly `planned-transfer` or `admin-unavailable`. No role, owner, verified flag, invitation, callback, user-selected new ID or extra fields are allowed. Never put actual credentials in shell arguments, history, checked-in files or ordinary logs.

After complete target/input validation, one verified reserved DB connection creates a new credential account via Better Auth's private, never-mounted signup composition. The tool supplies a fresh random private secret and fixed `.invalid` base URL; installed library password hashing uses only password and random salt, independently of the application secret. It does not create sessions. Only the helper's persisted verified ID reaches bootstrap/replacement. Duplicate or uncertain signup never adopts an existing email identity, retries or deletes accounts.

**Creation and activation are two separate transactions.** An activation failure can leave a new unentitled account. Exit 1, a lost readback, unhealthy connection or deadline may follow committed creation and/or committed activation. Stop and inspect accounts, credentials by presence only, singleton, membership, audit and sessions through an approved trusted procedure. Do not repeat credential creation, delete the new account automatically, change the expected admin to force progress or infer rollback. After inspection, deliberately using the existing-account command for a verified unentitled account is a separate operator decision.

The original 20-second hard process deadline covers input, imports, connection, provisioning, activation and close; the same owner health/termination barrier is retained. Forced termination cannot guarantee rollback or completed cleanup. Exit 0 prints only `Credential operator completed.` after activation commit, health, completed close and final health. Exit 1 prints only `Credential operator unavailable (configuration|input|connection|provisioning|activation|cleanup|deadline).` with one actual phase. No IDs, email, password, hash, token, auth response, SQL or error cause is printed. Earlier operation failure retains its phase if close also fails. `--help` remains offline even with invalid environment.
