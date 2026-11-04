import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import {
  at,
  epoch,
  type DispatchRow,
  type DispatchSchemaContext,
} from "./dispatch-schema.integration";
import { decodeDispatchAction } from "./dispatch-contract";

export async function dispatchSchemaCases(c: DispatchSchemaContext) {
  const { first, second } = c.proof;
  const capacity = {
    id: 1,
    launcher_installation_id: "fixture-installation",
    policy_version: "fixture-policy",
    global_limit: 2,
    actor_limit: 1,
    created_at: epoch,
  };
  await c.scenario("capacity singleton identifiers limits and finite-time insertion controls", () =>
    c.transaction(async () => {
      for (const [delta, constraint] of [
        [{ id: 2 }, "dispatch_capacity_singleton_check"],
        [{ global_limit: 3 }, "dispatch_capacity_limits_check"],
        [{ actor_limit: 2 }, "dispatch_capacity_limits_check"],
        [{ policy_version: "é" }, "dispatch_capacity_identifiers_check"],
        [{ launcher_installation_id: "x".repeat(129) }, "dispatch_capacity_identifiers_check"],
        [{ created_at: "infinity" }, "dispatch_capacity_time_check"],
        [{ created_at: "-infinity" }, "dispatch_capacity_time_check"],
      ] as const)
        await c.controlInsert("dispatch_capacity", capacity, delta, constraint);
    }),
  );
  await c.scenario(
    "explicit singleton A B owned leases claims and both action kinds commit and read back",
    async () => {
      await first.query("begin");
      const expected: string[] = [];
      try {
        await c.insert("dispatch_capacity", capacity);
        for (const owner of ["dispatch-a", "dispatch-b"] as const) {
          const claim = await c.prepared(await c.fixture(owner));
          for (const kind of ["activate", "input"] as const) {
            const grant = c.grant(claim, kind);
            await c.insert("dispatch_grants", grant);
            assert.equal(typeof grant.canonical_action, "string");
            if (typeof grant.canonical_action !== "string") throw new Error("fixture");
            expected.push(grant.canonical_action);
          }
        }
        await first.query("commit");
      } finally {
        await first.query("rollback");
      }
      const read = await second.query<{ canonical_action: string; owner_user_id: string }>(
        "select canonical_action,owner_user_id from dispatch_grants order by canonical_action",
      );
      assert.equal(read.rows.length, 4);
      assert.deepEqual(read.rows.map((r) => r.canonical_action).sort(), expected.sort());
      for (const row of read.rows)
        assert.equal(decodeDispatchAction(row.canonical_action).ownerUserId, row.owner_user_id);
      const specs = await second.query<{
        launch_spec_canonical: string;
        launch_spec_digest: string;
      }>("select launch_spec_canonical,launch_spec_digest from dispatch_claims");
      assert.equal(specs.rows.length, 2);
      const identity = await second.query<{
        matched: boolean;
      }>(`select bool_and(c.owner_user_id=a.owner_user_id and c.run_id=a.run_id
      and c.generation=a.generation and c.lease_id=a.lease_id and c.created_at=a.claimed_at) as matched
      from dispatch_claims c join run_attempts a on a.id=c.attempt_id`);
      assert.equal(identity.rows[0]?.matched, true);
      for (const row of specs.rows) {
        const { createHash } = await import("node:crypto");
        assert.equal(
          createHash("sha256").update(row.launch_spec_canonical).digest("hex"),
          row.launch_spec_digest,
        );
      }
    },
  );
  async function claimInsert(
    name: string,
    delta: DispatchRow,
    constraint: string | null,
    state = "23514",
  ) {
    await c.scenario(name, () =>
      c.transaction(async () =>
        c.controlInsert("dispatch_claims", await c.fixture(), delta, constraint, state),
      ),
    );
  }
  for (const [name, delta, constraint, state] of [
    ["claim unknown attempt FK", { attempt_id: uuidv7() }, "dispatch_claims_attempt_fk", "23503"],
    [
      "claim cross-owner FK",
      { owner_user_id: "dispatch-b" },
      "dispatch_claims_attempt_fk",
      "23503",
    ],
    ["claim foreign run FK", { run_id: uuidv7() }, "dispatch_claims_attempt_fk", "23503"],
    ["claim unknown policy FK", { policy_version: "other" }, "dispatch_claims_policy_fk", "23503"],
    ["claim zero generation", { generation: 0 }, "dispatch_claims_counters_check", "23514"],
    ["claim int32 overflow", { generation: 2147483648 }, null, "22003"],
    ["claim noninitial revision", { revision: 2 }, "dispatch_claims_initial", "23514"],
    ["claim initial updated timestamp", { updated_at: at(1) }, "dispatch_claims_initial", "23514"],
    ["claim pre-spent state", { resource_state: "unknown" }, "dispatch_claims_initial", "23514"],
    ["claim initial receipt", { receipt_id: uuidv7() }, "dispatch_claims_initial", "23514"],
    [
      "claim initial prepare intent",
      { prepare_intent_at: epoch },
      "dispatch_claims_initial",
      "23514",
    ],
    [
      "claim initial pending operation",
      { pending_operation_id: uuidv7() },
      "dispatch_claims_initial",
      "23514",
    ],
    [
      "claim initial cleanup",
      { cleanup_kind: "not_submitted" },
      "dispatch_claims_initial",
      "23514",
    ],
    ["claim initial cancellation", { cancel_reason: "owner" }, "dispatch_claims_initial", "23514"],
    ["claim initial release", { released_at: epoch }, "dispatch_claims_initial", "23514"],
    [
      "claim unsupported spec version",
      { launch_spec_version: 2 },
      "dispatch_claims_payload_check",
      "23514",
    ],
    [
      "claim nonarray canonical",
      { launch_spec_canonical: "{}" },
      "dispatch_claims_payload_check",
      "23514",
    ],
    [
      "claim invalid JSON",
      { launch_spec_canonical: "[" },
      "dispatch_claims_payload_check",
      "23514",
    ],
    [
      "claim UTF8 payload overflow",
      { launch_spec_canonical: '["' + "é".repeat(8191) + '"]' },
      "dispatch_claims_payload_check",
      "23514",
    ],
    [
      "claim invalid digest",
      { launch_spec_digest: "A".repeat(64) },
      "dispatch_claims_payload_check",
      "23514",
    ],
    [
      "claim invalid image digest",
      { image_digest: "sha256:bad" },
      "dispatch_claims_payload_check",
      "23514",
    ],
    [
      "claim nonpositive deadline",
      { deadline_at: epoch },
      "dispatch_claims_deadline_check",
      "23514",
    ],
    [
      "claim overlong deadline",
      { deadline_at: at(60001) },
      "dispatch_claims_deadline_check",
      "23514",
    ],
  ] as const)
    await claimInsert(name, delta, constraint, state);
  await c.scenario(
    "duplicate claim attempt operation and installation receipt reject with exact unique keys",
    () =>
      c.transaction(async () => {
        const a = await c.prepared(await c.fixture()),
          b = await c.fixture();
        await c.reject(
          () =>
            c.insert("dispatch_claims", {
              ...b,
              attempt_id: a.attempt_id ?? null,
              run_id: a.run_id ?? null,
            }),
          "dispatch_claims_pkey",
          "23505",
        );
        await c.reject(
          () =>
            c.insert("dispatch_claims", { ...b, claim_operation_id: a.claim_operation_id ?? null }),
          "dispatch_claims_operation_unique",
          "23505",
        );
        await c.insert("dispatch_claims", b);
        const bId = b.attempt_id;
        assert.equal(typeof bId, "string");
        if (typeof bId !== "string") throw new Error("fixture");
        await c.reject(
          () =>
            c.update("dispatch_claims", bId, {
              receipt_id: a.receipt_id ?? null,
              prepare_intent_at: at(1),
              resource_state: "prepared",
              revision: 2,
              updated_at: at(1),
            }),
          "dispatch_claims_installation_receipt_unique",
          "23505",
        );
      }),
  );
  await c.scenario(
    "multiple null receipts and exact canonical byte maximum remain valid structural controls",
    () =>
      c.transaction(async () => {
        for (let i = 0; i < 2; i++)
          await c.insert("dispatch_claims", {
            ...(await c.fixture()),
            generation: 2147483647,
            launch_spec_canonical: '["' + "é".repeat(8190) + '"]',
          });
        const read = await first.query<{ bytes: number }>(
          "select octet_length(launch_spec_canonical) as bytes from dispatch_claims where receipt_id is null",
        );
        assert.equal(read.rows.length, 2);
        for (const r of read.rows) assert.equal(r.bytes, 16384);
      }),
  );
  for (const [name, delta, constraint, state] of [
    ["grant cross-owner", { owner_user_id: "dispatch-b" }, "dispatch_grants_claim_fk", "23503"],
    ["grant foreign claim", { attempt_id: uuidv7() }, "dispatch_grants_claim_fk", "23503"],
    ["grant foreign run", { run_id: uuidv7() }, "dispatch_grants_claim_fk", "23503"],
    [
      "grant noninitial issued",
      { state: "issued", issued_at: epoch },
      "dispatch_grants_initial",
      "23514",
    ],
    [
      "grant noninitial uncertain",
      { state: "uncertain", delivery_outcome: "unknown" },
      "dispatch_grants_initial",
      "23514",
    ],
    ["grant noninitial revision", { revision: 2 }, "dispatch_grants_initial", "23514"],
    [
      "grant fixture connection",
      { connection_id: uuidv7() },
      "dispatch_grants_credentials_check",
      "23514",
    ],
    [
      "grant fixture credential",
      { credential_version: 1 },
      "dispatch_grants_credentials_check",
      "23514",
    ],
    ["grant unknown kind", { kind: "tool" }, "dispatch_grants_action_check", "23514"],
    ["grant activation sequence", { sequence: 2 }, "dispatch_grants_action_check", "23514"],
    ["grant empty text", { canonical_action: "" }, "dispatch_grants_payload_check", "23514"],
    ["grant nonarray text", { canonical_action: "{}" }, "dispatch_grants_payload_check", "23514"],
    [
      "grant oversized text",
      { canonical_action: '["' + "x".repeat(16381) + '"]' },
      "dispatch_grants_payload_check",
      "23514",
    ],
    [
      "grant malformed digest",
      { action_digest: "x".repeat(64) },
      "dispatch_grants_payload_check",
      "23514",
    ],
    ["grant zero expiry", { expires_at: epoch }, "dispatch_grants_expiry_check", "23514"],
    ["grant overlong expiry", { expires_at: at(30001) }, "dispatch_grants_expiry_check", "23514"],
  ] as const)
    await c.scenario(name, () =>
      c.transaction(async () =>
        c.controlInsert(
          "dispatch_grants",
          c.grant(await c.prepared(await c.fixture())),
          delta,
          constraint,
          state,
        ),
      ),
    );
  await c.scenario(
    "grant separate activation input sequences unique action and bounded input controls",
    () =>
      c.transaction(async () => {
        const claim = await c.prepared(await c.fixture()),
          activation = c.grant(claim),
          input = c.grant(claim, "input");
        await c.insert("dispatch_grants", activation);
        await c.insert("dispatch_grants", input);
        await c.reject(
          () =>
            c.insert("dispatch_grants", {
              ...input,
              id: uuidv7(),
              action_id: activation.action_id ?? null,
              sequence: 2,
            }),
          "dispatch_grants_attempt_action_unique",
          "23505",
        );
        await c.reject(
          () => c.insert("dispatch_grants", { ...input, id: uuidv7(), action_id: uuidv7() }),
          "dispatch_grants_attempt_sequence_unique",
          "23505",
        );
        const boundary = { ...input, id: uuidv7(), action_id: uuidv7(), sequence: 65537 };
        await c.controlInsert(
          "dispatch_grants",
          boundary,
          { sequence: 65538 },
          "dispatch_grants_action_check",
        );
        await c.controlInsert(
          "dispatch_grants",
          boundary,
          { sequence: 0 },
          "dispatch_grants_action_check",
        );
        await c.insert("dispatch_grants", boundary);
        const maximum = {
          ...input,
          id: uuidv7(),
          action_id: uuidv7(),
          sequence: 2,
          canonical_action: '["' + "é".repeat(8190) + '"]',
        };
        await c.insert("dispatch_grants", maximum);
        const bytes = await first.query<{ bytes: number }>(
          "select octet_length(canonical_action) as bytes from dispatch_grants where id=$1",
          [maximum.id],
        );
        assert.equal(bytes.rows[0]?.bytes, 16384);
      }),
  );
}
