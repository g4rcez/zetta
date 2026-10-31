// Opt-in service/database proof; imports never start services or open a database.
import { uuidv7 } from "@zetta/core/uuid";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import type { Database } from "@zetta/db";
import type { ActiveActor } from "../identity/access";
import type { createConnectionStore } from "./store";
import { requireIdentityAuthProofTarget } from "../identity/signup.integration";

type Store = Awaited<ReturnType<typeof createConnectionStore>>;
type Proof = Awaited<
  ReturnType<
    typeof import("../../../../../packages/db/src/connection-proof-client").openConnectionProof
  >
>;
type Result<T> = Readonly<{ ok: true; value: T } | { ok: false; code: string }>;
export type StoreProofContext = Readonly<{
  proof: Proof;
  actors: readonly [ActiveActor, ActiveActor, ActiveActor];
  pids: readonly [number, number, number];
  configuration: Readonly<{ key: string; keyId: string }>;
  make: (
    db: Pick<Database, "transaction">,
    initializeEmpty?: boolean,
    nonce?: (size: number) => Uint8Array,
    key?: string,
  ) => Promise<Store>;
  reset: () => Promise<void>;
  fresh: (nonce?: (size: number) => Uint8Array) => Promise<readonly [Store, Store]>;
  input: () => {
    operationId: string;
    provider: string;
    label: string;
    secret: Buffer;
    expiresAt: null;
  };
  capture: <T>(promise: Promise<T>) => Promise<Result<T>>;
  deny: (work: () => unknown | Promise<unknown>, code: string) => Promise<void>;
  scenario: (name: string, work: () => Promise<void>) => Promise<void>;
  counts: () => Promise<string>;
  wait: (pid: number, blocker: number, queryFragment: string) => Promise<void>;
}>;

export async function runConnectionStoreProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => {
      process.stderr.write("Connection store proof deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 120_000);
    let proof: Proof | undefined;
    const restore: (() => void)[] = [];
    let attempts = 0,
      checks = 0;
    try {
      phase = "guarded setup";
      const { openConnectionProof } =
        await import("../../../../../packages/db/src/connection-proof-client");
      proof = await openConnectionProof(target.connectionString);
      const activeProof = proof;
      const net = (await import("node:net")).default,
        tls = (await import("node:tls")).default;
      const dns = (await import("node:dns")).default,
        http = (await import("node:http")).default,
        https = (await import("node:https")).default;
      const forbidden = () => {
        attempts++;
        throw new Error("Unintended outbound IO.");
      };
      for (const [object, key] of [
        [net.Socket.prototype, "connect"],
        [net.Server.prototype, "listen"],
        [tls, "connect"],
        [dns, "lookup"],
        [dns, "resolve"],
        [dns.promises, "lookup"],
        [dns.promises, "resolve"],
        [http, "request"],
        [http, "get"],
        [https, "request"],
        [https, "get"],
        [Bun, "connect"],
        [Bun, "listen"],
        [Bun, "serve"],
        [globalThis, "fetch"],
      ] as const) {
        const previous = Reflect.get(object, key);
        assert.equal(Reflect.set(object, key, forbidden), true);
        restore.push(() => {
          Reflect.set(object, key, previous);
        });
      }
      const { createConnectionStore: factory } = await import("./store");
      const { createIdentityAccess, createMembershipLookup, AccessError } =
        await import("../identity/access");
      const { ConnectionStoreError } = await import("./store-contract");
      const { owner, firstDb, secondDb } = proof;
      const configuration = Object.freeze({
        key: randomBytes(32).toString("base64"),
        keyId: "synthetic",
      });
      phase = "controlled-session membership fixtures";
      await owner.query(`insert into "user" (id,name,email,email_verified,created_at,updated_at)
        select id,id,id||'@connection.invalid',true,now(),now() from unnest(array['owner-a','owner-b','owner-admin']) id;
        insert into membership (user_id,status,joined_at,updated_at) select id,'active',now(),now() from "user";
        insert into installation_identity (id,admin_user_id,admin_membership_status,bootstrapped_at) values (1,'owner-admin','active',now());`);
      const access = createIdentityAccess(
        {
          api: {
            getSession: async ({ headers }) => {
              const id = headers.get("x-synthetic-actor");
              return id && ["owner-a", "owner-b", "owner-admin"].includes(id)
                ? { user: { id } }
                : null;
            },
          },
        },
        createMembershipLookup(firstDb),
      );
      const actors: ActiveActor[] = [];
      for (const id of ["owner-a", "owner-b", "owner-admin"]) {
        actors.push(await access.requireActive(new Headers({ "x-synthetic-actor": id })));
      }
      const [a, b, admin] = actors;
      assert.ok(a && b && admin);
      assert.equal(admin.isAdmin, true);
      const pid = async (client: Proof["owner"]) => {
        const row = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0];
        assert.ok(row);
        return row.pid;
      };
      const pids = [await pid(owner), await pid(proof.first), await pid(proof.second)] as const;
      const make: StoreProofContext["make"] = (
        db,
        initializeEmpty = false,
        nonce,
        key = configuration.key,
      ) =>
        factory(
          db,
          {
            configuration: { ...configuration, key },
            allowedProviders: ["synthetic", "other"],
            initializeEmpty,
          },
          nonce,
        );
      const reset = async () => {
        await owner.query(
          "truncate connection_mutation_receipt,connection_credential,connection_user_key,connection_key_check,connection_nonce,connection",
        );
        await owner.query(
          "update membership set status='active',removed_at=null,updated_at=now() where user_id='owner-a'",
        );
      };
      const capture: StoreProofContext["capture"] = (promise) =>
        promise.then(
          (value) => ({ ok: true as const, value }),
          (error) => ({
            ok: false as const,
            code:
              error instanceof AccessError || error instanceof ConnectionStoreError
                ? error.code
                : "unexpected",
          }),
        );
      const context: StoreProofContext = {
        proof,
        actors: [a, b, admin],
        pids,
        configuration,
        make,
        reset,
        fresh: async (nonce) => {
          await reset();
          return [await make(firstDb, true, nonce), await make(secondDb)] as const;
        },
        input: () => ({
          operationId: uuidv7(),
          provider: "synthetic",
          label: " Synthetic label ",
          secret: Buffer.from("\ufeff\0 synthetic credential bytes "),
          expiresAt: null,
        }),
        capture,
        deny: async (work, code) => {
          const result = await capture(Promise.resolve().then(work));
          assert.equal(!result.ok && result.code === code, true);
        },
        scenario: async (name, work) => {
          phase = name;
          await work();
          activeProof.healthy();
          assert.equal(attempts, 0);
          checks++;
          process.stdout.write(`PASS ${name}\n`);
        },
        counts: async () =>
          JSON.stringify(
            (
              await owner.query(`select (select count(*) from connection) as connections,
          (select count(*) from connection_credential) as versions,(select count(*) from connection_nonce) as nonces,
          (select count(*) from connection_mutation_receipt) as receipts,(select encryption_count from connection_key_check) as encryptions`)
            ).rows,
          ),
        wait: async (blockedPid, blocker, fragment) => {
          const until = performance.now() + 1800;
          while (performance.now() < until) {
            await owner.query("select pg_stat_clear_snapshot()");
            const result = await owner.query<{ blocked: boolean }>(
              `select wait_event_type='Lock' and $2=any(pg_blocking_pids(pid))
              and position($3 in query)>0 as blocked from pg_stat_activity where pid=$1`,
              [blockedPid, blocker, fragment],
            );
            if (result.rows[0]?.blocked) return;
          }
          throw new Error("Expected database lock barrier unavailable.");
        },
      };
      const { runStoreCases } = await import("./store-proof-cases");
      const { runStoreRaces } = await import("./store-proof-races");
      await runStoreCases(context);
      await runStoreRaces(context);
      phase = "known fixture cleanup";
      await reset();
      await owner.query(
        'truncate installation_identity,membership,"user",account,session,invitation,identity_audit,verification,connection,connection_credential,connection_user_key,connection_nonce,connection_key_check,connection_mutation_receipt',
      );
      const remaining = await owner.query<{ total: string }>(
        'select (select count(*) from "user")+(select count(*) from connection_nonce) as total',
      );
      assert.equal(Number(remaining.rows[0]?.total), 0);
      process.stdout.write(
        `PASS actual connection metadata store proof (${checks} checks); controlled sessions; fixtures cleared\n`,
      );
    } finally {
      const previousPhase = phase;
      phase = "reserved client cleanup";
      try {
        await proof?.close();
        assert.equal(attempts, 0);
      } finally {
        for (const undo of restore.reverse()) undo();
        clearTimeout(deadline);
      }
      phase = previousPhase;
    }
    process.stdout.write("PASS reserved connection clients closed; no new network attempts\n");
  } catch {
    // no-excuse-ok: catch -- fixed phases only, never assertion/driver/key data.
    process.stderr.write(`Connection store proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}
if (import.meta.main) await runConnectionStoreProof();
