import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@zetta/db";
import { createConnectionCrypto, type ConnectionEnvelope } from "./crypto";
import type { ConnectionMetadata } from "./store-contract";
import type { StoreProofContext } from "./store.integration";

const safe = (value: ConnectionMetadata) => assert.equal(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([
  "id", "kind", "provider", "label", "state", "revision", "credentialVersion", "createdAt", "updatedAt", "expiresAt", "revokedAt",
].sort()), true);

export async function runStoreCases(c: StoreProofContext) {
  const { proof: { owner, firstDb, secondDb }, actors: [a, b, admin] } = c;
  await c.scenario("actual create list replace revoke and owned ciphertext roundtrip", async () => {
    const [store] = await c.fresh(); const input = c.input(); const originalBytes = Buffer.from(input.secret);
    const created = await store.createApiKey(a, input); safe(created);
    assert.equal(created.revision === 1 && created.credentialVersion === 1 && created.label === input.label, true);
    assert.equal(input.secret.equals(originalBytes), true);
    const row = (await owner.query<ConnectionEnvelope>(`select envelope_version as "envelopeVersion",algorithm,key_id as "keyId",nonce,tag,ciphertext
      from connection_credential where connection_id=$1`, [created.id])).rows[0]; assert.ok(row);
    const opened = createConnectionCrypto(c.configuration).open(row, { ownerUserId: a.userId, connectionId: created.id, kind: "api-key", credentialVersion: 1 });
    try { assert.equal(opened.equals(originalBytes), true); } finally { opened.fill(0); originalBytes.fill(0); }
    const replaced = await store.replaceApiKey(a, { id: created.id, operationId: randomUUID(), expectedRevision: 1, secret: Buffer.from("new synthetic bytes") });
    assert.equal(replaced.revision === 2 && replaced.credentialVersion === 2, true); safe(replaced);
    const revoked = await store.revoke(a, { id: created.id, operationId: randomUUID(), expectedRevision: 2 });
    assert.equal(revoked.revision === 3 && revoked.state === "revoked" && revoked.revokedAt !== null, true); safe(revoked);
    const list = await store.listOwned(a, {}); assert.equal(list.items.length, 1); assert.equal(JSON.stringify(list.items[0]) === JSON.stringify(revoked), true);
    const retained = (await owner.query<{ versions: number; nonces: number; current: number }>(`select
      (select count(*)::int from connection_credential where connection_id=$1) as versions,
      (select count(*)::int from connection_nonce where connection_id=$1) as nonces,
      (select count(*)::int from connection_credential v join connection m on m.id=v.connection_id and m.current_credential_version=v.credential_version where m.id=$1) as current`, [created.id])).rows[0];
    assert.equal(retained?.versions === 2 && retained.nonces === 2 && retained.current === 1, true);
    await c.deny(() => store.replaceApiKey(a, { id: created.id, expectedRevision: 3, operationId: randomUUID(), secret: input.secret }), "conflict");
  });
  await c.scenario("original receipt replays after replace revoke and now expired create request", async () => {
    const [store] = await c.fresh();
    const clock = (await owner.query<{ now: string }>("select floor(extract(epoch from clock_timestamp())*1000)::text as now")).rows[0]; assert.ok(clock);
    const input = { ...c.input(), expiresAt: Number(clock.now) + 1000 };
    const created = await store.createApiKey(a, input);
    const replacementInput = { id: created.id, operationId: randomUUID(), expectedRevision: 1, secret: input.secret };
    const replaced = await store.replaceApiKey(a, replacementInput);
    const revokeInput = { id: created.id, operationId: randomUUID(), expectedRevision: 2 }; const revoked = await store.revoke(a, revokeInput);
    const deadline = performance.now() + 2000;
    while (true) {
      assert.equal(performance.now() < deadline, true);
      const now = (await owner.query<{ expired: boolean }>("select floor(extract(epoch from clock_timestamp())*1000)>=$1 as expired", [input.expiresAt])).rows[0];
      if (now?.expired) break;
    }
    const before = await c.counts();
    assert.equal(JSON.stringify(await store.createApiKey(a, input)) === JSON.stringify(created), true);
    assert.equal(JSON.stringify(await store.replaceApiKey(a, replacementInput)) === JSON.stringify(replaced), true);
    assert.equal(JSON.stringify(await store.revoke(a, revokeInput)) === JSON.stringify(revoked), true);
    assert.equal(await c.counts(), before);
  });
  await c.scenario("every mutation semantic argument and operation type conflicts on replay", async () => {
    const [store] = await c.fresh(); const input = c.input(); const created = await store.createApiKey(a, input);
    for (const change of [{ provider: "other" }, { label: "different" }, { secret: Buffer.from("different") }, { expiresAt: Date.now() + 60000 }])
      await c.deny(() => store.createApiKey(a, { ...input, ...change }), "conflict");
    await c.deny(() => store.revoke(a, { operationId: input.operationId, id: created.id, expectedRevision: 1 }), "conflict");
    const replacement = { id: created.id, operationId: randomUUID(), expectedRevision: 1, secret: input.secret };
    await store.replaceApiKey(a, replacement);
    await c.deny(() => store.revoke(a, { id: created.id, operationId: replacement.operationId, expectedRevision: 1 }), "conflict");
    for (const change of [{ id: randomUUID() }, { expectedRevision: 2 }, { secret: Buffer.from("different") }, { expiresAt: Date.now() + 60000 }])
      await c.deny(() => store.replaceApiKey(a, { ...replacement, ...change }), "conflict");
    const revoke = { id: created.id, operationId: randomUUID(), expectedRevision: 2 }; await store.revoke(a, revoke);
    await c.deny(() => store.replaceApiKey(a, { ...revoke, secret: input.secret }), "conflict");
    for (const change of [{ id: randomUUID() }, { expectedRevision: 3 }]) await c.deny(() => store.revoke(a, { ...revoke, ...change }), "conflict");
    const otherOwner = await store.createApiKey(b, input); assert.notEqual(otherOwner.id, created.id);
  });
  await c.scenario("foreign admin forged and removed actors denied with safe metadata only", async () => {
    const [store] = await c.fresh(); const input = c.input(); const created = await store.createApiKey(a, input);
    for (const actor of [b, admin, { userId: a.userId, isAdmin: true }]) {
      await c.deny(() => store.revoke(actor, { id: created.id, operationId: randomUUID(), expectedRevision: 1 }), "NOT_FOUND");
      await c.deny(() => store.replaceApiKey(actor, { id: created.id, operationId: randomUUID(), expectedRevision: 1, secret: input.secret }), "NOT_FOUND");
    }
    assert.equal((await store.listOwned(b, {})).items.length, 0); assert.equal((await store.listOwned(admin, {})).items.length, 0);
    await c.deny(() => store.listOwned({ userId: a.userId, isAdmin: false }, {}), "NOT_FOUND");
    await owner.query("update membership set status='removed',removed_at=now() where user_id='owner-a'");
    await c.deny(() => store.createApiKey(a, input), "ACCESS_DENIED"); await c.deny(() => store.listOwned(a, {}), "ACCESS_DENIED");
    await c.deny(() => store.replaceApiKey(a, { id: created.id, expectedRevision: 1, operationId: randomUUID(), secret: input.secret }), "ACCESS_DENIED");
    await c.deny(() => store.revoke(a, { id: created.id, expectedRevision: 1, operationId: randomUUID() }), "ACCESS_DENIED");
  });
  await c.scenario("owner-bound pagination rejects tampering and visits each owned ID once", async () => {
    const [store] = await c.fresh(); const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await store.createApiKey(a, c.input())).id);
    await store.createApiKey(b, c.input()); const page = await store.listOwned(a, { limit: 1 }); assert.ok(page.nextCursor);
    await c.deny(() => store.listOwned(b, { limit: 1, cursor: page.nextCursor }), "invalid-input");
    await c.deny(() => store.listOwned(a, { limit: 1, cursor: page.nextCursor + "x" }), "invalid-input");
    const seen = page.items.map(item => item.id); let cursor: string | null = page.nextCursor;
    while (cursor) { const next = await store.listOwned(a, { limit: 1, cursor }); seen.push(...next.items.map(item => item.id)); cursor = next.nextCursor; assert.equal(seen.length <= 3, true); }
    assert.equal(JSON.stringify(seen) === JSON.stringify(ids.sort()), true);
  });
  await c.scenario("same database fresh factory verifies key and retains references", async () => {
    const [store] = await c.fresh(); const created = await store.createApiKey(a, c.input());
    const restarted = await c.make(secondDb); const items = (await restarted.listOwned(a, {})).items;
    assert.equal(items.length === 1 && items[0]?.id === created.id, true);
    await c.deny(() => c.make(secondDb, false, undefined, randomBytes(32).toString("base64")), "unavailable");
    await c.deny(() => c.make(secondDb, false, undefined, ""), "invalid-input");
  });
  await c.scenario("missing corrupt or inconsistent key-check startup fails closed", async () => {
    await c.reset(); await c.deny(() => c.make(firstDb), "unavailable");
    await c.make(firstDb, true); await owner.query("update connection_key_check set tag=$1", [Buffer.alloc(16)]);
    await c.deny(() => c.make(secondDb), "unavailable");
    await c.fresh(); await owner.query("update connection_key_check set encryption_count=2"); await c.deny(() => c.make(secondDb), "unavailable");
    const [store] = await c.fresh(); await store.createApiKey(a, c.input()); await owner.query("delete from connection_key_check");
    const before = await c.counts(); await c.deny(() => c.make(secondDb, true), "unavailable"); assert.equal(await c.counts(), before);
  });
  await c.scenario("nonce collision retry succeeds on third attempt then exhaustion rolls back", async () => {
    const nonce0 = Buffer.alloc(12, 1), nonce1 = Buffer.alloc(12, 2), nonce2 = Buffer.alloc(12, 3);
    let sequence = [nonce0, nonce1], calls = 0;
    const source = (size: number) => { assert.equal(size, 12); calls++; const nonce = sequence.shift(); assert.ok(nonce); return nonce; };
    const [store] = await c.fresh(source); const created = await store.createApiKey(a, c.input()); assert.equal(calls, 2);
    sequence = [nonce1, nonce1, nonce2]; calls = 0;
    await store.replaceApiKey(a, { id: created.id, expectedRevision: 1, operationId: randomUUID(), secret: c.input().secret }); assert.equal(calls, 3);
    await owner.query("delete from connection_credential where connection_id=$1 and credential_version=1", [created.id]);
    const before = await c.counts(); sequence = [nonce1, nonce1, nonce1]; calls = 0;
    await c.deny(() => store.createApiKey(a, c.input()), "unavailable"); assert.equal(calls, 3); assert.equal(await c.counts(), before);
    assert.equal((await owner.query<{ count: number }>("select count(*)::int as count from connection_nonce where nonce=$1", [nonce1])).rows[0]?.count, 1);
  });
  await c.scenario("credential insert fault rolls back every mutation row and counter", async () => {
    const [store] = await c.fresh(); const before = await c.counts();
    await owner.query(`create function connection_proof_insert_fault() returns trigger language plpgsql as $$ begin raise exception 'synthetic proof fault' using errcode='P0001'; end $$;
      create trigger connection_proof_insert_fault before insert on connection_credential for each row execute function connection_proof_insert_fault()`);
    try { await c.deny(() => store.createApiKey(a, c.input()), "outcome-unknown"); assert.equal(await c.counts(), before); }
    finally { await owner.query("drop trigger connection_proof_insert_fault on connection_credential; drop function connection_proof_insert_fault()"); }
  });
  await c.scenario("committed result lost at transaction wrapper reconciles identical operation", async () => {
    await c.reset(); let lose = false;
    const wrapper: Pick<Database, "transaction"> = { transaction: async (work, options) => {
      const result = await firstDb.transaction(work, options); if (lose) { lose = false; throw new Error("synthetic acknowledgment loss"); } return result;
    } };
    const store = await c.make(wrapper, true); const input = c.input(); lose = true;
    await c.deny(() => store.createApiKey(a, input), "outcome-unknown");
    const observer = await c.make(secondDb); const items = (await observer.listOwned(a, {})).items; assert.equal(items.length, 1);
    const before = await c.counts(); const recovered = await store.createApiKey(a, input);
    assert.equal(recovered.id, items[0]?.id); assert.equal(await c.counts(), before);
  });
  await c.scenario("revision and credential-version overflow deny without partial mutation", async () => {
    const [store] = await c.fresh(); const created = await store.createApiKey(a, c.input());
    await owner.query("update connection set revision=2147483647 where id=$1", [created.id]); const before = await c.counts();
    await c.deny(() => store.revoke(a, { id: created.id, expectedRevision: 2147483647, operationId: randomUUID() }), "conflict");
    await owner.query("update connection set revision=1,current_credential_version=2147483647 where id=$1", [created.id]);
    await c.deny(() => store.replaceApiKey(a, { id: created.id, expectedRevision: 1, operationId: randomUUID(), secret: c.input().secret }), "conflict");
    assert.equal(await c.counts(), before);
  });
}
