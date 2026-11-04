// Standalone structural SQL proof; importing this module never opens a connection.
import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { requireIdentityAuthProofTarget } from "../identity/signup.integration";
import { canonicalDispatchAction, digestDispatchAction } from "./dispatch-contract";

type Proof = Awaited<
  ReturnType<
    typeof import("../../../../../packages/db/src/dispatch-proof-client").openDispatchProof
  >
>;
export type DispatchRow = Readonly<Record<string, string | number | Date | null>>;
export type DispatchTable = "dispatch_capacity" | "dispatch_claims" | "dispatch_grants";
export const epoch = new Date("2026-01-01T00:00:00.000Z");
export const at = (offset: number) => new Date(epoch.getTime() + offset);
export type DispatchSchemaContext = {
  proof: Proof;
  scenario(name: string, work: () => Promise<void>): Promise<void>;
  transaction(work: () => Promise<void>): Promise<void>;
  reject(work: () => Promise<unknown>, constraint: string | null, state?: string): Promise<void>;
  fixture(owner?: "dispatch-a" | "dispatch-b"): Promise<DispatchRow>;
  grant(claim: DispatchRow, kind?: "activate" | "input"): DispatchRow;
  insert(table: DispatchTable, row: DispatchRow): Promise<void>;
  update(table: DispatchTable, id: string | number, patch: DispatchRow): Promise<void>;
  controlInsert(
    table: DispatchTable,
    row: DispatchRow,
    delta: DispatchRow,
    constraint: string | null,
    state?: string,
  ): Promise<void>;
  prepared(claim: DispatchRow): Promise<DispatchRow>;
};
export function matchesDispatchFailure(error: unknown, state: string, constraint: string | null) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === state &&
    (constraint === null || ("constraint" in error && error.constraint === constraint))
  );
}
export async function runDispatchSchemaProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => {
      process.stderr.write("Dispatch schema proof deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 120_000);
    let proof: Proof | undefined;
    let guard:
      | Awaited<
          ReturnType<
            typeof import("../../../../../packages/db/src/run-readback-proof-client").forbidRunProofIO
          >
        >
      | undefined;
    let count = 0;
    try {
      phase = "guarded baseline and pinned dispatch migrations";
      const { openDispatchProof } =
        await import("../../../../../packages/db/src/dispatch-proof-client");
      proof = await openDispatchProof(target.connectionString);
      const { forbidRunProofIO } =
        await import("../../../../../packages/db/src/run-readback-proof-client");
      guard = await forbidRunProofIO();
      const active = proof,
        io = guard,
        first = proof.first;
      phase = "synthetic owner and explicit capacity bootstrap";
      await proof.owner
        .query(`insert into "user" (id,name,email,email_verified,created_at,updated_at) values
        ('dispatch-a','Synthetic A','a@dispatch.invalid',true,now(),now()),('dispatch-b','Synthetic B','b@dispatch.invalid',true,now(),now());
        insert into membership(user_id,status,joined_at,updated_at) select id,'active',now(),now() from "user"`);
      async function insertRaw(table: string, row: DispatchRow) {
        const columns = Object.keys(row);
        await first.query(
          `insert into ${table} (${columns.map((c) => `"${c}"`).join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
          Object.values(row),
        );
      }
      const c: DispatchSchemaContext = {
        proof,
        async scenario(name, work) {
          phase = name;
          await work();
          active.healthy();
          io.healthy();
          count++;
          process.stdout.write(`PASS ${name}\n`);
        },
        async transaction(work) {
          await first.query("begin");
          try {
            await work();
          } finally {
            await first.query("rollback");
          }
        },
        async reject(work, constraint, state = "23514") {
          await first.query("savepoint negative_oracle");
          let matched = false;
          try {
            await work();
          } catch (error) {
            matched = matchesDispatchFailure(error, state, constraint);
            if (!matched)
              process.stderr.write(
                `Dispatch oracle mismatch: expected-state=${matchesDispatchFailure(error, state, null)}; expected-constraint=${error instanceof Error && "constraint" in error && error.constraint === constraint}.\n`,
              );
          } finally {
            await first.query(
              "rollback to savepoint negative_oracle; release savepoint negative_oracle",
            );
          }
          assert.equal(matched, true);
        },
        async fixture(owner = "dispatch-a") {
          const run = uuidv7(),
            attempt = uuidv7(),
            lease = uuidv7();
          await insertRaw("runs", {
            id: run,
            owner_user_id: owner,
            request_key: uuidv7(),
            origin_kind: "interactive",
            bot_id: "fixture-bot",
            conversation_id: "fixture-conversation",
            configuration_id: "fixture-configuration",
            configuration_version: 1,
            input_version: 1,
            input_snapshot: "[1]",
            created_at: epoch,
            revision: 1,
            status: "running",
            current_generation: 1,
          });
          await insertRaw("run_attempts", {
            id: attempt,
            run_id: run,
            owner_user_id: owner,
            generation: 1,
            created_at: epoch,
            status: "running",
            effect_state: "no_effect",
            lease_id: lease,
            lease_expires_at: at(60000),
            claimed_at: epoch,
          });
          const tuple = JSON.stringify([
            "zetta.launch.spec",
            1,
            [
              owner,
              run,
              attempt,
              "fixture-bot",
              "fixture-conversation",
              "fixture-configuration",
              null,
              null,
            ],
            lease,
            1,
            "fixture-v1",
            "echo",
            "fixture-policy",
            at(60000).getTime(),
            [60000, 65536, 65536, 8192],
          ]);
          return {
            attempt_id: attempt,
            run_id: run,
            owner_user_id: owner,
            generation: 1,
            lease_id: lease,
            claim_operation_id: uuidv7(),
            launcher_installation_id: "fixture-installation",
            policy_version: "fixture-policy",
            launch_spec_version: 1,
            launch_spec_canonical: tuple,
            launch_spec_digest: createHash("sha256").update(tuple).digest("hex"),
            launch_identity_digest: "a".repeat(64),
            image_digest: `sha256:${"b".repeat(64)}`,
            deadline_at: at(60000),
            resource_state: "not_submitted",
            revision: 1,
            created_at: epoch,
            updated_at: epoch,
          };
        },
        grant(claim, kind = "activate") {
          const actionId = uuidv7();
          const action = {
            version: 1,
            ownerUserId: claim.owner_user_id,
            runId: claim.run_id,
            attemptId: claim.attempt_id,
            generation: 1,
            leaseId: claim.lease_id,
            actionId,
            launcherInstallationId: "fixture-installation",
            policyVersion: "fixture-policy",
            receiptId: claim.receipt_id,
            connectionId: null,
            credentialVersion: null,
            expiresAtMs: at(30000).getTime(),
            kind,
            sequence: 1,
            descriptor:
              kind === "activate"
                ? ["activate", actionId, "a".repeat(64)]
                : ["input", actionId, 1, 0, true, createHash("sha256").update("").digest("hex")],
          };
          return {
            id: uuidv7(),
            attempt_id: claim.attempt_id ?? null,
            run_id: claim.run_id ?? null,
            owner_user_id: claim.owner_user_id ?? null,
            action_id: actionId,
            kind,
            sequence: 1,
            canonical_action: canonicalDispatchAction(action),
            action_digest: digestDispatchAction(action),
            expires_at: at(30000),
            state: "pending",
            delivery_outcome: "not_attempted",
            revision: 1,
            created_at: epoch,
            updated_at: epoch,
          };
        },
        insert: insertRaw,
        async update(table, id, patch) {
          const key = table === "dispatch_claims" ? "attempt_id" : "id",
            columns = Object.keys(patch);
          const row = await first.query(
            `update ${table} set ${columns.map((c, i) => `"${c}"=$${i + 1}`).join(",")} where ${key}=$${columns.length + 1}`,
            [...Object.values(patch), id],
          );
          assert.equal(row.rowCount, 1);
        },
        async controlInsert(table, row, delta, constraint, state = "23514") {
          await first.query("savepoint positive_control");
          await insertRaw(table, row);
          await first.query(
            "rollback to savepoint positive_control; release savepoint positive_control",
          );
          await c.reject(() => insertRaw(table, { ...row, ...delta }), constraint, state);
        },
        async prepared(claim) {
          await insertRaw("dispatch_claims", claim);
          const receipt = uuidv7(),
            id = claim.attempt_id;
          assert.equal(typeof id, "string");
          if (typeof id !== "string") throw new Error("fixture");
          const patch = {
            resource_state: "prepared",
            receipt_id: receipt,
            prepare_intent_at: at(1),
            revision: 2,
            updated_at: at(1),
          };
          await c.update("dispatch_claims", id, patch);
          return { ...claim, ...patch };
        },
      };
      const { dispatchSchemaCases } = await import("./dispatch-schema-cases");
      const { dispatchSchemaTransitions } = await import("./dispatch-schema-transitions");
      await dispatchSchemaCases(c);
      await dispatchSchemaTransitions(c);
      active.healthy();
      io.healthy();
      process.stdout.write(
        `PASS dispatch structural SQL proof (${count} checks); committed tombstones retained for whole-service disposal; no new network attempts\n`,
      );
    } finally {
      const prior = phase;
      phase = "reserved client closure";
      try {
        if (proof) {
          try {
            for (const client of [proof.first, proof.second, proof.owner])
              await client.query("rollback");
          } finally {
            await proof.close();
          }
        }
        guard?.healthy();
      } finally {
        guard?.restore();
        clearTimeout(deadline);
      }
      phase = prior;
    }
    process.stdout.write("PASS reserved dispatch clients closed\n");
  } catch {
    // no-excuse-ok: catch -- fixed phase only; no raw SQL, driver errors or row content.
    process.stderr.write(`Dispatch schema proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}
if (import.meta.main) await runDispatchSchemaProof();
