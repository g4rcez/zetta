// Standalone proof only: importing this file never opens a database or application.
import { strict as assert } from "node:assert";
import { requireIdentityAuthProofTarget } from "../identity/signup.integration";

export async function runConnectionSchemaProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => {
      process.stderr.write("Connection schema proof deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 90_000);
    let proof: Awaited<ReturnType<typeof import("../../../../../packages/db/src/connection-proof-client").openConnectionProof>> | undefined;
    const restore: (() => void)[] = [];
    let outboundAttempts = 0;
    let checks = 0;
    let transaction = false;
    const forbidden = () => { outboundAttempts++; throw new Error("Unintended outbound IO."); };
    try {
      phase = "guarded database and pinned migration setup";
      const { openConnectionProof } = await import("../../../../../packages/db/src/connection-proof-client");
      proof = await openConnectionProof(target.connectionString);
      const { owner } = proof;
      const net = (await import("node:net")).default;
      const tls = (await import("node:tls")).default;
      const dns = (await import("node:dns")).default;
      const http = (await import("node:http")).default;
      const https = (await import("node:https")).default;
      for (const [object, key] of [
        [net.Socket.prototype, "connect"], [net.Server.prototype, "listen"], [tls, "connect"],
        [dns, "lookup"], [dns, "resolve"], [dns.promises, "lookup"], [dns.promises, "resolve"],
        [http, "request"], [http, "get"], [https, "request"], [https, "get"],
        [Bun, "connect"], [Bun, "listen"], [Bun, "serve"], [globalThis, "fetch"],
      ] as const) {
        const previous = Reflect.get(object, key);
        assert.equal(Reflect.set(object, key, forbidden), true);
        restore.push(() => { Reflect.set(object, key, previous); });
      }
      async function scenario(name: string, work: () => Promise<void>) {
        phase = name;
        await owner.query("savepoint connection_schema_case");
        try {
          await work();
          proof?.healthy();
          assert.equal(outboundAttempts, 0);
          checks++;
          process.stdout.write(`PASS ${name}\n`);
        } finally {
          await owner.query("rollback to savepoint connection_schema_case");
          await owner.query("release savepoint connection_schema_case");
        }
      }
      async function reject(name: string, query: string, values: readonly unknown[], constraint: string, code = "23514") {
        await scenario(name, async () => {
          let matched = false;
          let rejected = false;
          let stateMatched = false;
          let constraintMatched = false;
          let restrictViolation = false;
          try { await owner.query(query, [...values]); }
          catch (error) {
            // Only compare driver identity privately; never print SQL, fields or raw errors.
            rejected = true;
            restrictViolation = error instanceof Error && "code" in error && error.code === "23001";
            stateMatched = error instanceof Error && "code" in error && error.code === code;
            constraintMatched = error instanceof Error && "constraint" in error && error.constraint === constraint;
            matched = stateMatched && constraintMatched;
          }
          if (!matched) process.stderr.write(`Connection schema oracle mismatch: rejected=${rejected}; expected-state=${stateMatched}; expected-constraint=${constraintMatched}; observed-state-is-23001=${restrictViolation}.\n`);
          assert.equal(matched, true);
        });
      }
      phase = "valid synthetic A and B baseline";
      await owner.query("begin");
      transaction = true;
      await owner.query(`insert into "user" (id,name,email,email_verified,created_at,updated_at) values
        ('owner-a','Synthetic A','a@connection.invalid',true,now(),now()),
        ('owner-b','Synthetic B','b@connection.invalid',true,now(),now());
        insert into connection (id,owner_user_id,kind,provider,label,state,revision,current_credential_version,created_at,updated_at) values
        ('00000000-0000-4000-8000-000000000001','owner-a','api-key','synthetic','Synthetic A','active',1,1,now(),now()),
        ('00000000-0000-4000-8000-000000000002','owner-b','api-key','synthetic','Synthetic B','active',1,1,now(),now());
        insert into connection_nonce (key_id,nonce,purpose,connection_id,credential_version,created_at) values
        ('synthetic',decode(repeat('01',12),'hex'),'credential','00000000-0000-4000-8000-000000000001',1,now()),
        ('synthetic',decode(repeat('02',12),'hex'),'credential','00000000-0000-4000-8000-000000000002',1,now()),
        ('synthetic',decode(repeat('03',12),'hex'),'key-check',null,null,now());
        insert into connection_credential (connection_id,credential_version,owner_user_id,kind,envelope_version,algorithm,key_id,nonce,tag,ciphertext,created_at)
        select id,1,owner_user_id,'api-key',1,'aes-256-gcm','synthetic',decode(repeat(case when owner_user_id='owner-a' then '01' else '02' end,12),'hex'),decode(repeat('04',16),'hex'),decode('05','hex'),now() from connection;
        insert into connection_key_check (id,envelope_version,algorithm,key_id,nonce,tag,ciphertext,nonce_purpose,encryption_count,created_at)
        values (1,1,'aes-256-gcm','synthetic',decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),decode('05','hex'),'key-check',3,now());
        insert into connection_mutation_receipt (owner_user_id,operation_id,operation,connection_id,request_mac,kind,provider,label,state,revision,credential_version,created_at,updated_at)
        select owner_user_id,'00000000-0000-4000-8000-000000000010','create-api-key',id,decode(repeat('06',32),'hex'),kind,provider,label,state,revision,current_credential_version,created_at,updated_at from connection;`);
      await scenario("valid A and B envelopes and owner-scoped shared operation ID", async () => {
        const rows = await owner.query<{ owner: string; count: number }>(`select c.owner_user_id as owner,count(*)::int as count from connection c
          join connection_credential v on v.connection_id=c.id and v.owner_user_id=c.owner_user_id and v.kind=c.kind
          join connection_mutation_receipt r on r.connection_id=c.id and r.owner_user_id=c.owner_user_id group by c.owner_user_id order by c.owner_user_id`);
        assert.equal(JSON.stringify(rows.rows) === JSON.stringify([{ owner: "owner-a", count: 1 }, { owner: "owner-b", count: 1 }]), true);
      });
      await reject("unknown user denied", `insert into connection (id,owner_user_id,kind,provider,label,state,revision,current_credential_version,created_at,updated_at)
        values ('00000000-0000-4000-8000-000000000003','missing','api-key','synthetic','Synthetic','active',1,1,now(),now())`, [], "connection_owner_user_id_user_id_fkey", "23503");
      await reject("credential foreign owner denied", "update connection_credential set owner_user_id='owner-b' where owner_user_id='owner-a'", [], "connection_credential_owner_fk", "23503");
      await reject("credential unsupported kind denied", "update connection_credential set kind='native-profile' where owner_user_id='owner-a'", [], "connection_credential_kind_check");
      await reject("credential mismatched nonce version identity denied", "update connection_credential set credential_version=2 where owner_user_id='owner-a'", [], "connection_credential_nonce_fk", "23503");
      await reject("credential mismatched nonce connection identity denied", "update connection_credential set nonce=decode(repeat('02',12),'hex') where owner_user_id='owner-a'", [], "connection_credential_nonce_fk", "23503");
      await reject("duplicate key nonce denied", "insert into connection_nonce select * from connection_nonce where purpose='key-check'", [], "connection_nonce_pkey", "23505");
      await reject("referenced ledger deletion denied", "delete from connection_nonce where purpose='credential'", [], "connection_credential_nonce_fk", "23001");
      await reject("null credential nonce identity denied", "update connection_nonce set credential_version=null where purpose='credential'", [], "connection_nonce_identity_check");
      for (const length of [11, 13]) await reject(`ledger nonce length ${length} denied`, "update connection_nonce set nonce=$1", [Buffer.alloc(length)], "connection_nonce_length_check");
      await reject("unknown nonce purpose denied", "update connection_nonce set purpose='unknown' where purpose='key-check'", [], "connection_nonce_identity_check");
      await scenario("replacement and ciphertext removal retain old nonce tombstone", async () => {
        await owner.query(`insert into connection_nonce (key_id,nonce,purpose,connection_id,credential_version,created_at)
          values ('synthetic',decode(repeat('07',12),'hex'),'credential','00000000-0000-4000-8000-000000000001',2,now());
          insert into connection_credential select connection_id,2,owner_user_id,kind,envelope_version,algorithm,key_id,decode(repeat('07',12),'hex'),tag,ciphertext,created_at from connection_credential where owner_user_id='owner-a';
          update connection set current_credential_version=2,revision=2 where owner_user_id='owner-a';
          delete from connection_credential where owner_user_id='owner-a' and credential_version=1;`);
        const retained = await owner.query<{ count: number }>("select count(*)::int as count from connection_nonce where connection_id='00000000-0000-4000-8000-000000000001' and credential_version=1");
        assert.equal(retained.rows[0]?.count, 1);
        await reject("retained tombstone still denies duplicate nonce", "insert into connection_nonce select * from connection_nonce where credential_version=1 and connection_id='00000000-0000-4000-8000-000000000001'", [], "connection_nonce_pkey", "23505");
      });
      for (const [column, length, constraint] of [["nonce", 11, "nonce"], ["nonce", 13, "nonce"], ["tag", 15, "tag"], ["tag", 17, "tag"], ["ciphertext", 0, "ciphertext"], ["ciphertext", 16385, "ciphertext"]] as const) {
        for (const table of ["connection_credential", "connection_key_check"] as const) {
          await reject(`${table} ${column} length ${length} denied`, `update ${table} set ${column}=$1`, [Buffer.alloc(length)], `${table}_${constraint}_check`);
        }
      }
      await scenario("maximum ciphertext bytes accepted", async () => {
        for (const table of ["connection_credential", "connection_key_check"] as const) {
          const result = await owner.query(`update ${table} set ciphertext=$1 returning octet_length(ciphertext) as bytes`, [Buffer.alloc(16384)]);
          assert.equal(result.rows.length, table === "connection_credential" ? 2 : 1);
          assert.equal(result.rows.every((row) => row.bytes === 16384), true);
        }
      });
      for (const table of ["connection_credential", "connection_key_check"] as const) {
        await reject(`${table} unknown envelope version denied`, `update ${table} set envelope_version=2`, [], `${table}_envelope_check`);
        await reject(`${table} unknown algorithm denied`, `update ${table} set algorithm='unknown'`, [], `${table}_envelope_check`);
        await reject(`${table} malformed key ID denied`, `update ${table} set key_id='UPPER'`, [], `${table}_key_id_check`);
      }
      await reject("key-check credential nonce substitution denied", "update connection_key_check set nonce=decode(repeat('01',12),'hex')", [], "connection_key_check_nonce_fk", "23503");
      await reject("non-singleton key-check denied", "update connection_key_check set id=2", [], "connection_key_check_singleton_check");
      await reject("duplicate singleton denied", "insert into connection_key_check select * from connection_key_check", [], "connection_key_check_pkey", "23505");
      for (const count of [0, 1000001]) await reject(`encryption count ${count} denied`, "update connection_key_check set encryption_count=$1", [count], "connection_key_check_count_check");
      await scenario("encryption count ceiling accepted", async () => {
        const result = await owner.query<{ count: number }>("update connection_key_check set encryption_count=1000000 returning encryption_count as count");
        assert.equal(result.rows[0]?.count, 1000000);
      });
      for (const [column, value, constraint] of [
        ["provider", "https://invalid.example", "provider"], ["provider", "a".repeat(65), "provider"],
        ["label", "", "label"], ["label", "a".repeat(101), "label"], ["state", "unknown", "state"],
        ["revision", 0, "revision"], ["current_credential_version", 0, "version"],
      ] as const) await reject(`connection ${constraint} invalid variant denied`, `update connection set ${column}=$1`, [value], `connection_${constraint}_check`);
      await scenario("Unicode label and canonical provider boundaries accepted", async () => {
        const result = await owner.query<{ bytes: number }>("update connection set label=$1,provider=$2 returning octet_length(label) as bytes", ["😀".repeat(100), "a".repeat(64)]);
        assert.equal(result.rows.length === 2 && result.rows.every((row) => row.bytes === 400), true);
      });
      await reject("receipt foreign owner denied", "update connection_mutation_receipt set connection_id='00000000-0000-4000-8000-000000000002' where owner_user_id='owner-a'", [], "connection_receipt_owner_fk", "23503");
      await reject("duplicate owner operation denied", "insert into connection_mutation_receipt select * from connection_mutation_receipt where owner_user_id='owner-a'", [], "connection_mutation_receipt_pkey", "23505");
      for (const length of [31, 33]) await reject(`request MAC length ${length} denied`, "update connection_mutation_receipt set request_mac=$1", [Buffer.alloc(length)], "connection_receipt_mac_check");
      await reject("unknown receipt operation denied", "update connection_mutation_receipt set operation='unknown'", [], "connection_receipt_operation_check");
      await reject("create receipt expected revision denied", "update connection_mutation_receipt set expected_revision=1", [], "connection_receipt_operation_check");
      await reject("create receipt result version mismatch denied", "update connection_mutation_receipt set credential_version=2", [], "connection_receipt_operation_check");
      await scenario("valid replacement receipt retains original safe result", async () => {
        await owner.query("update connection_mutation_receipt set operation='replace-api-key',expected_revision=1,revision=2,credential_version=2 where owner_user_id='owner-a'");
        await owner.query("update connection set revision=3,label='Later synthetic label' where owner_user_id='owner-a'");
        const result = await owner.query<{ revision: number; label: string }>("select revision,label from connection_mutation_receipt where owner_user_id='owner-a'");
        assert.equal(result.rows[0]?.revision === 2 && result.rows[0]?.label === "Synthetic A", true);
        await reject("replacement receipt zero expected revision denied", "update connection_mutation_receipt set expected_revision=0 where owner_user_id='owner-a'", [], "connection_receipt_operation_check");
        await reject("replacement receipt expected revision mismatch denied", "update connection_mutation_receipt set expected_revision=2 where owner_user_id='owner-a'", [], "connection_receipt_operation_check");
      });
      await scenario("receipt signed integer revision ceiling accepted", async () => {
        const result = await owner.query<{ revision: number }>("update connection_mutation_receipt set operation='replace-api-key',expected_revision=2147483646,revision=2147483647 where owner_user_id='owner-a' returning revision");
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0]?.revision, 2147483647);
      });
      await scenario("valid revoke receipt and revoked metadata accepted", async () => {
        await owner.query("update connection_mutation_receipt set operation='revoke',expected_revision=1,revision=2,state='revoked',revoked_at=now() where owner_user_id='owner-a'");
        const result = await owner.query<{ state: string }>("update connection set state='revoked',revoked_at=now(),revision=2 where owner_user_id='owner-a' returning state");
        assert.equal(result.rows[0]?.state, "revoked");
        await reject("revoke receipt active result denied", "update connection_mutation_receipt set operation='replace-api-key' where owner_user_id='owner-a'", [], "connection_receipt_operation_check");
      });
      await reject("revoked metadata missing timestamp denied", "update connection set state='revoked'", [], "connection_state_check");
      await reject("active receipt revoked timestamp denied", "update connection_mutation_receipt set revoked_at=now()", [], "connection_receipt_state_check");
      await scenario("control current version existence requires service enforcement", async () => {
        await owner.query("update connection set current_credential_version=2 where owner_user_id='owner-a'");
        const result = await owner.query<{ count: number }>(`select count(*)::int as count from connection c join connection_credential v
          on v.connection_id=c.id and v.credential_version=c.current_credential_version where c.owner_user_id='owner-a'`);
        assert.equal(result.rows[0]?.count, 0);
      });
      phase = "fixture rollback readback";
      await owner.query("rollback");
      transaction = false;
      const remaining = await owner.query<{ count: number }>(`select (select count(*) from "user") + (select count(*) from connection)
        + (select count(*) from connection_credential) + (select count(*) from connection_nonce)
        + (select count(*) from connection_key_check) + (select count(*) from connection_mutation_receipt) as count`);
      assert.equal(Number(remaining.rows[0]?.count), 0);
      proof.healthy();
      assert.equal(outboundAttempts, 0);
      process.stdout.write(`PASS actual PostgreSQL connection schema proof (${checks} checks); fixtures rolled back; no new network attempts\n`);
    } finally {
      const previousPhase = phase;
      phase = "reserved client cleanup";
      try {
        try { if (transaction && proof) await proof.owner.query("rollback"); }
        finally { await proof?.close(); }
        assert.equal(outboundAttempts, 0);
      } finally {
        for (const undo of restore.reverse()) undo();
        clearTimeout(deadline);
      }
      phase = previousPhase;
    }
    process.stdout.write("PASS reserved connection clients closed\n");
  } catch { // no-excuse-ok: catch -- safe fixed phase only; never serialize driver or assertion data.
    process.stderr.write(`Connection schema proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await runConnectionSchemaProof();
