import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import { at, epoch, type DispatchRow, type DispatchSchemaContext, type DispatchTable } from "./dispatch-schema.integration";
import { parseDispatchGrant } from "./dispatch-state";

export async function dispatchSchemaTransitions(c: DispatchSchemaContext) {
  const first = c.proof.first;
  function key(row: DispatchRow, field = "attempt_id") { const value = row[field]; assert.equal(typeof value, "string"); if (typeof value !== "string") throw new Error("fixture"); return value; }
  await c.scenario("singleton rejects update delete and truncate while history guards retain tombstones", () => c.transaction(async () => {
    for (const command of ["update dispatch_capacity set global_limit=global_limit", "delete from dispatch_capacity", "truncate dispatch_capacity cascade"])
      await c.reject(() => first.query(command), "dispatch_capacity_frozen");
    for (const table of ["dispatch_claims", "dispatch_grants"] as const) {
      await c.reject(() => first.query(`delete from ${table}`), "dispatch_tombstones_retained");
      await c.reject(() => first.query(`truncate ${table} cascade`), "dispatch_tombstones_retained");
    }
    assert.equal((await first.query<{ count: number }>("select count(*)::int as count from dispatch_grants")).rows[0]?.count, 4);
  }));
  await c.scenario("every immutable claim field rejects an otherwise monotonic update", () => c.transaction(async () => {
    const claim = await c.prepared(await c.fixture()), id = key(claim);
    for (const [column, value] of Object.entries({ attempt_id: uuidv7(), run_id: uuidv7(), owner_user_id: "dispatch-b", generation: 2,
      lease_id: uuidv7(), claim_operation_id: uuidv7(), launcher_installation_id: "other", policy_version: "other", launch_spec_version: 2,
      launch_spec_canonical: "[2]", launch_spec_digest: "c".repeat(64), launch_identity_digest: "c".repeat(64), image_digest: `sha256:${"c".repeat(64)}`, deadline_at: at(59000), created_at: at(1) })) {
      await c.reject(() => c.update("dispatch_claims", id, { [column]: value, revision: 3, updated_at: at(2) }), "dispatch_claims_identity_immutable");
    }
  }));
  await c.scenario("claim closed pairs state and time checks reject while valid controls update", () => c.transaction(async () => {
    const id = key(await c.prepared(await c.fixture()));
    for (const [delta, constraint] of [
      [{ resource_state: "arbitrary" }, "dispatch_claims_state_check"],
      [{ pending_operation_id: uuidv7() }, "dispatch_claims_pending_check"],
      [{ pending_operation_kind: "input" }, "dispatch_claims_pending_check"],
      [{ pending_operation_id: uuidv7(), pending_operation_kind: "arbitrary" }, "dispatch_claims_pending_check"],
      [{ cleanup_kind: "removed" }, "dispatch_claims_cleanup_check"],
      [{ cleanup_confirmed_at: at(2) }, "dispatch_claims_cleanup_check"],
      [{ cleanup_kind: "not_submitted", cleanup_confirmed_at: at(2) }, "dispatch_claims_cleanup_check"],
      [{ resource_state: "cleaned" }, "dispatch_claims_cleanup_check"],
      [{ released_at: at(2) }, "dispatch_claims_release_check"],
      [{ cancel_reason: "owner" }, "dispatch_claims_cancel_check"],
      [{ cancel_requested_at: at(2) }, "dispatch_claims_cancel_check"],
      [{ cancel_reason: "arbitrary", cancel_requested_at: at(2) }, "dispatch_claims_cancel_check"],
      [{ cancel_reason: "deadline", cancel_requested_at: at(2) }, "dispatch_claims_cancel_check"],
      [{ updated_at: "infinity" }, "dispatch_claims_time_check"],
      [{ cleanup_kind: "removed", resource_state: "cleaned", cleanup_confirmed_at: "infinity", updated_at: "infinity" }, "dispatch_claims_time_check"],
      [{ cancel_reason: "owner", cancel_requested_at: at(-1) }, "dispatch_claims_time_check"],
    ] as const) await c.reject(() => c.update("dispatch_claims", id, { revision: 3, updated_at: at(2), ...delta }), constraint);
    const pending = uuidv7();
    await c.update("dispatch_claims", id, { pending_operation_id: pending, pending_operation_kind: "input", revision: 3, updated_at: at(2) });
    await c.reject(() => c.update("dispatch_claims", id, { resource_state: "cleaned", cleanup_kind: "removed", cleanup_confirmed_at: at(3), revision: 4, updated_at: at(3) }), "dispatch_claims_cleanup_check");
    await c.update("dispatch_claims", id, { pending_operation_id: null, pending_operation_kind: null, revision: 4, updated_at: at(3) });
  }));
  await c.scenario("prepare pending missing receipt unknown and late receipt preserve structural facts", () => c.transaction(async () => {
    const claim = await c.fixture(), id = key(claim); await c.insert("dispatch_claims", claim);
    await c.reject(() => c.update("dispatch_claims", id, { receipt_id: uuidv7(), revision: 2, updated_at: at(1) }), "dispatch_claims_state_check");
    await c.reject(() => c.update("dispatch_claims", id, { resource_state: "prepare_pending", prepare_intent_at: at(1), revision: 2, updated_at: at(1) }), "dispatch_claims_state_check");
    const pending = uuidv7();
    await c.update("dispatch_claims", id, { resource_state: "prepare_pending", prepare_intent_at: at(1), pending_operation_id: pending, pending_operation_kind: "prepare", revision: 2, updated_at: at(1) });
    await c.update("dispatch_claims", id, { resource_state: "unknown", revision: 3, updated_at: at(2) });
    await c.reject(() => c.update("dispatch_claims", id, { pending_operation_kind: "input", revision: 4, updated_at: at(3) }), "dispatch_claims_pending_check");
    await c.update("dispatch_claims", id, { receipt_id: uuidv7(), revision: 4, updated_at: at(3) });
    const read = (await first.query<{ pending_operation_id: string; resource_state: string }>("select pending_operation_id,resource_state from dispatch_claims where attempt_id=$1", [id])).rows[0];
    assert.equal(read?.pending_operation_id, pending); assert.equal(read?.resource_state, "unknown");
  }));
  await c.scenario("receipt prepare cancellation cleanup release facts bind once and released row is inert", () => c.transaction(async () => {
    const id = key(await c.prepared(await c.fixture()));
    for (const delta of [{ receipt_id: null }, { receipt_id: uuidv7() }, { prepare_intent_at: null }, { prepare_intent_at: at(2) }, { resource_state: "not_submitted" }])
      await c.reject(() => c.update("dispatch_claims", id, { ...delta, revision: 3, updated_at: at(2) }), "dispatch_claims_forward_only");
    await c.update("dispatch_claims", id, { cancel_reason: "owner", cancel_requested_at: at(2), revision: 3, updated_at: at(2) });
    await c.reject(() => c.update("dispatch_claims", id, { cancel_reason: "shutdown", revision: 4, updated_at: at(3) }), "dispatch_claims_forward_only");
    await c.reject(() => c.update("dispatch_claims", id, { cancel_requested_at: at(3), revision: 4, updated_at: at(3) }), "dispatch_claims_forward_only");
    await c.update("dispatch_claims", id, { resource_state: "cleaned", cleanup_kind: "removed", cleanup_confirmed_at: at(3), revision: 4, updated_at: at(3) });
    for (const delta of [{ cleanup_kind: null, cleanup_confirmed_at: null }, { cleanup_confirmed_at: at(4) }, { resource_state: "active" }, { pending_operation_id: uuidv7(), pending_operation_kind: "stop" }])
      await c.reject(() => c.update("dispatch_claims", id, { ...delta, revision: 5, updated_at: at(4) }), "dispatch_claims_forward_only");
    await c.reject(() => c.update("dispatch_claims", id, { released_at: at(2), revision: 5, updated_at: at(4) }), "dispatch_claims_release_check");
    await c.update("dispatch_claims", id, { released_at: at(4), revision: 5, updated_at: at(4) });
    await c.update("dispatch_claims", id, { revision: 5 });
    for (const delta of [{ released_at: null }, { released_at: at(5) }, { revision: 6, updated_at: at(5) }])
      await c.reject(() => c.update("dispatch_claims", id, delta), "dispatch_claims_forward_only");
  }));
  await c.scenario("never-submitted cleanup is structurally valid without asserting terminal or external authority", () => c.transaction(async () => {
    const claim = await c.fixture(), id = key(claim); await c.insert("dispatch_claims", claim);
    await c.update("dispatch_claims", id, { cleanup_kind: "not_submitted", cleanup_confirmed_at: at(1), released_at: at(1), revision: 2, updated_at: at(1) });
    const row = (await first.query<{ status: string }>("select status from run_attempts where id=$1", [id])).rows[0];
    assert.equal(row?.status, "running"); // Deliberate structural-only control: service must reject this as real release authority.
  }));
  await c.scenario("claim and grant revision rollback jump maximum and integer overflow reject", () => c.transaction(async () => {
    const claim = await c.prepared(await c.fixture()), grant = c.grant(claim); await c.insert("dispatch_grants", grant);
    await c.update("dispatch_grants", key(grant, "id"), { state: "issued", issued_at: at(1), revision: 2, updated_at: at(1) });
    for (const [table, id] of [["dispatch_claims", key(claim)], ["dispatch_grants", key(grant, "id")]] satisfies [DispatchTable, string][]) {
      for (const revision of [1, 2, 4, 2147483647]) await c.reject(() => c.update(table, id, { revision, updated_at: at(2) }), "dispatch_revision_monotonic");
      await c.reject(() => c.update(table, id, { revision: 2147483648, updated_at: at(2) }), null, "22003");
      await c.reject(() => c.update(table, id, { revision: 3, updated_at: epoch }), "dispatch_revision_monotonic");
      await c.update(table, id, { revision: 2, updated_at: at(1) });
    }
  }));
  await c.scenario("temporary row exercises actual revision-function exhaustion branch without changing public guards", () => c.transaction(async () => {
    await first.query(`create temp table revision_counter_probe(revision integer,updated_at timestamptz) on commit drop;
      insert into revision_counter_probe values(2147483647,'2026-01-01T00:00:00Z');
      create trigger revision_counter_probe_guard before update on revision_counter_probe
      for each row execute function public.dispatch_guard_revision()`);
    await c.reject(() => first.query("update revision_counter_probe set updated_at=updated_at+interval '1 millisecond'"), "dispatch_revision_monotonic");
    assert.equal((await first.query<{ revision: number }>("select revision from revision_counter_probe")).rows[0]?.revision, 2147483647);
    assert.equal((await first.query<{ count: number }>("select count(*)::int as count from pg_tables where schemaname='public'")).rows[0]?.count, 18);
  }));
  await c.scenario("every immutable grant field rejects an otherwise monotonic update", () => c.transaction(async () => {
    const grant = c.grant(await c.prepared(await c.fixture())); await c.insert("dispatch_grants", grant);
    for (const [column, value] of Object.entries({ id: uuidv7(), attempt_id: uuidv7(), run_id: uuidv7(), owner_user_id: "dispatch-b", action_id: uuidv7(),
      kind: "input", sequence: 2, canonical_action: "[2]", action_digest: "c".repeat(64), connection_id: uuidv7(), credential_version: 1, expires_at: at(29000), created_at: at(1) }))
      await c.reject(() => c.update("dispatch_grants", key(grant, "id"), { [column]: value, revision: 2, updated_at: at(1) }), "dispatch_grants_identity_immutable");
  }));
  await c.scenario("unknown grant then late acknowledgement keeps null issue time and never readmits", () => c.transaction(async () => {
    const grant = c.grant(await c.prepared(await c.fixture())); await c.insert("dispatch_grants", grant); const id = key(grant, "id");
    await c.update("dispatch_grants", id, { state: "uncertain", delivery_outcome: "unknown", revision: 2, updated_at: at(1) });
    await c.update("dispatch_grants", id, { delivery_outcome: "acknowledged", revision: 3, updated_at: at(2) });
    const row = (await first.query<{ state: string; delivery_outcome: string; issued_at: Date | null; revision: number; updated_at: Date }>("select state,delivery_outcome,issued_at,revision,updated_at from dispatch_grants where id=$1", [id])).rows[0]; assert.ok(row);
    const parsed = parseDispatchGrant({ id, canonicalAction: grant.canonical_action, revision: row.revision, state: row.state, deliveryOutcome: row.delivery_outcome,
      createdAtMs: epoch.getTime(), updatedAtMs: row.updated_at.getTime(), issuedAtMs: row.issued_at, cancelledAtMs: null });
    assert.equal(parsed.state, "uncertain"); assert.equal(parsed.issuedAtMs, null);
    await c.update("dispatch_grants", id, { delivery_outcome: "acknowledged", revision: 3, updated_at: at(2) });
    for (const delta of [{ state: "pending", delivery_outcome: "not_attempted" }, { delivery_outcome: "unknown" }, { state: "issued", issued_at: at(1) }, { issued_at: at(1) }])
      await c.reject(() => c.update("dispatch_grants", id, { ...delta, revision: 4, updated_at: at(3) }), "dispatch_grants_forward_only");
  }));
  await c.scenario("issued cancellation expiry and timestamp controls retain spent admission", () => c.transaction(async () => {
    const grant = c.grant(await c.prepared(await c.fixture())); await c.insert("dispatch_grants", grant); const id = key(grant, "id");
    await c.reject(() => c.update("dispatch_grants", id, { revision: 2, updated_at: at(1) }), "dispatch_grants_forward_only");
    await c.reject(() => c.update("dispatch_grants", id, { state: "issued", revision: 2, updated_at: at(1) }), "dispatch_grants_state_check");
    await c.reject(() => c.update("dispatch_grants", id, { state: "issued", issued_at: at(30000), revision: 2, updated_at: at(30000) }), "dispatch_grants_time_check");
    await c.update("dispatch_grants", id, { state: "issued", issued_at: at(1), revision: 2, updated_at: at(1) });
    await c.reject(() => c.update("dispatch_grants", id, { state: "expired", issued_at: null, revision: 3, updated_at: at(30000) }), "dispatch_grants_forward_only");
    await c.reject(() => c.update("dispatch_grants", id, { cancelled_at: epoch, revision: 3, updated_at: at(2) }), "dispatch_grants_time_check");
    await c.reject(() => c.update("dispatch_grants", id, { updated_at: "infinity", revision: 3 }), "dispatch_grants_time_check");
    await c.update("dispatch_grants", id, { cancelled_at: at(2), revision: 3, updated_at: at(2) });
    await c.reject(() => c.update("dispatch_grants", id, { cancelled_at: null, revision: 4, updated_at: at(3) }), "dispatch_grants_forward_only");
    await c.update("dispatch_grants", id, { state: "issued" });
    const read = (await first.query<{ state: string; revision: number }>("select state,revision from dispatch_grants where id=$1", [id])).rows[0];
    assert.equal(read?.state, "issued"); assert.equal(read?.revision, 3);
  }));
  await c.scenario("cancelled and expired grants retain exact no-op tombstones", () => c.transaction(async () => {
    for (const state of ["cancelled", "expired"] as const) {
      const grant = c.grant(await c.prepared(await c.fixture())); await c.insert("dispatch_grants", grant); const id = key(grant, "id");
      if (state === "expired") await c.reject(() => c.update("dispatch_grants", id, { state, revision: 2, updated_at: at(29999) }), "dispatch_grants_state_check");
      await c.update("dispatch_grants", id, { state, revision: 2, updated_at: at(30000), ...(state === "cancelled" ? { cancelled_at: at(30000) } : {}) });
      await c.update("dispatch_grants", id, { state });
      await c.reject(() => c.update("dispatch_grants", id, { state: "pending", cancelled_at: null, revision: 3, updated_at: at(30001) }), "dispatch_grants_forward_only");
      await c.reject(() => first.query("delete from dispatch_grants where id=$1", [id]), "dispatch_tombstones_retained");
    }
  }));
}
