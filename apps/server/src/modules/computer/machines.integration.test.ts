import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { sealedFor } from "../../test-support/sealed";
import { createConnectionsService } from "../connections/service";
import { createConnectionStore } from "../connections/store";
import {
  createIdentityAccess,
  createMembershipLookup,
  issueBackgroundActor,
} from "../identity/access";
import type { MachineRunner, Op, Target } from "./machine-runner";
import { createMachineService } from "./machines";
import { createDbVmStore, createVmService } from "./vm";
import { vmSecretsFrom } from "./vm-secrets";

/**
 * Machines end to end through the HTTP routes with a real database and the real connections store: a key or password is sealed in
 * transit, encrypted at rest, and never comes back in any response, list, audit row or error. The runner is a fake that records what
 * it was given, so no network or ssh is needed here (machine-runner.test.ts and a real sshd cover the runner).
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url?.endsWith("/zetta_test") ? describe : describe.skip; // initializes a key check: only ever against the dedicated test database
const ids = [`mach-a-${uuidv7()}`, `mach-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const KEY = Buffer.alloc(32, 7).toString("base64");

// Fake material, not a real key. The runner is a fake, so only the text matters.
const PRIVATE_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "ZmFrZS1rZXktbWF0ZXJpYWwtZm9yLXRlc3RzLW9ubHktbm90LWEtcmVhbC1rZXktYWFhYWFhYWFhYWFh",
  "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJi",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");
const NEW_PRIVATE_KEY = PRIVATE_KEY.replaceAll("YmJi", "Y2Nj");
const FTP_PASSWORD = "fake-ftp-password-123";
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIATuBV2ktuq3oFQO73FGrq92TshlkGHPmbljpoDTEOZT";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPublicKeyOfTheFakePrivateKeyXXXXXXXXXXXX";

suite("machines against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const seen: { target: Target; secret: string; op: Op }[] = [];
  let reply: { exitCode: number; output: string } = { exitCode: 0, output: "uid=1000(deploy)" };
  const runner = {
    scan: async () => [
      {
        type: "ssh-ed25519",
        key: HOST_KEY,
        fingerprint: "SHA256:vrHPOFcz7mGR1uHRp0PH82dQOQY9pq+2GaWfhttdTeA",
      },
    ],
    publicKey: async () => PUBLIC_KEY,
    exec: async (target: Target, secret: string, op: Op) => {
      seen.push({ target, secret, op });
      return { ...reply, truncated: false };
    },
  } as unknown as MachineRunner;
  let app: ReturnType<typeof createApp>;
  let machines: ReturnType<typeof createMachineService>;
  const reached: { endpoint: string; token: string }[] = [];
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return {
      status: r.status,
      text: await r.clone().text(),
      json: (await r.json().catch(() => ({}))) as any,
    };
  };
  // Two bots of A (the machine is shared with the first, sometimes the second) and one of B.
  let botA: string;
  let botA2: string;
  let botB: string;
  const create = async (
    as: string,
    over: Record<string, unknown> = {},
    secret = PRIVATE_KEY,
    kind = "ssh",
  ) =>
    call(as, "POST", "/api/computer/machines", {
      name: "web server",
      kind,
      host: "93.184.216.34",
      username: "deploy",
      botIds: [botA],
      ...(kind === "ftp" ? {} : { hostKey: HOST_KEY }),
      sealed: await sealedFor(as, `machine.create:${kind}`, { secret }),
      ...over,
    });

  beforeAll(async () => {
    const store = await createConnectionStore(db, {
      configuration: { key: KEY, keyId: "v1" },
      allowedProviders: ["machine"],
      initializeEmpty: true,
    });
    const connections = createConnectionsService(db, store);
    machines = createMachineService({ db, connections, runner });
    const lookup = createMembershipLookup(db);
    const vms = createVmService({
      store: createDbVmStore(db),
      docker: { bin: "docker", image: "none", memory: "1g", cpus: "1", pids: 100, shm: "64m" },
      // A remote computer must never touch a container.
      exec: async () => {
        throw new Error("docker must not be used for a remote computer");
      },
      tokenRoot: await mkdtemp(join(tmpdir(), "zvm-")),
      secrets: vmSecretsFrom(
        () => connections,
        (id) => issueBackgroundActor(lookup, id),
      ),
      connectRemote: async (endpoint, token) => {
        reached.push({ endpoint, token });
        return {
          call: async () => ({ text: "ok", isError: false }),
          close: async () => {},
        };
      },
    });
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      computer: { access, computer: {} as never, machines, vms },
      connections: { access, connections },
      webOrigin: "http://web.test",
      desktopOrigins: [],
      drain: () => {},
    });
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    const mkBot = async (ownerUserId: string, name: string) =>
      (
        await db
          .insert(bot)
          .values({
            ownerUserId,
            kind: "specialist",
            visibility: "private",
            name,
            slug: `${name}-${uuidv7().slice(-8)}`,
          })
          .returning({ id: bot.id })
      )[0]!.id;
    botA = await mkBot(A, "ops");
    botA2 = await mkBot(A, "docs");
    botB = await mkBot(B, "theirs");
  });
  afterAll(async () => {
    await db.$client.query("delete from machine where owner_user_id = any($1)", [ids]);
    await db.$client.query("delete from computer_vm where owner_user_id = any($1)", [ids]);
    for (const t of ["connection_credential", "connection_mutation_receipt"])
      await db.$client.query(`delete from ${t} where owner_user_id = any($1)`, [ids]);
    await db.$client.query("delete from connection where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids); // connection_nonce is an append-only ledger checked against the key check: never delete from it
  });

  test("an ssh machine is created with a sealed key; no response, list or database column holds the key", async () => {
    const made = await create(A);
    expect(made.status).toBe(201);
    expect(made.json.machine).toMatchObject({
      name: "web server",
      kind: "ssh",
      host: "93.184.216.34",
      port: 22,
      username: "deploy",
      fingerprint: "SHA256:vrHPOFcz7mGR1uHRp0PH82dQOQY9pq+2GaWfhttdTeA",
      hasSecret: true,
      publicKey: PUBLIC_KEY,
    });
    const list = await call(A, "GET", "/api/computer/machines");
    expect(list.json.machines).toHaveLength(1);
    for (const body of [made.text, list.text]) {
      expect(body).not.toContain("ZmFrZS1rZXktbWF0ZXJpYWw");
      expect(body).not.toContain("BEGIN OPENSSH");
    }
    const stored = await db.$client.query(
      "select c.ciphertext from connection_credential c join machine m on m.connection_id = c.connection_id where m.owner_user_id = $1",
      [A],
    );
    expect(stored.rows).toHaveLength(1);
    expect(Buffer.from(stored.rows[0].ciphertext).includes("ZmFrZS1rZXktbWF0ZXJpYWw")).toBe(false);
  });

  test("the machine's connection is not in the user's own connection list", async () => {
    const r = await call(A, "GET", "/api/connections");
    expect(r.status).toBe(200);
    expect(r.json.connections).toEqual([]);
    expect(r.json.providers).not.toContain("machine");
  });

  test("a plaintext secret, a secret sealed for another purpose, and a secret sealed for another user are all refused", async () => {
    expect(
      (await create(A, { sealed: undefined, secret: PRIVATE_KEY, name: "plain" })).status,
    ).toBe(400);
    const wrongPurpose = await sealedFor(A, "machine.create:ftp", { secret: PRIVATE_KEY });
    expect((await create(A, { sealed: wrongPurpose, name: "purpose" })).status).toBe(400);
    const wrongUser = await sealedFor(B, "machine.create:ssh", { secret: PRIVATE_KEY });
    expect((await create(A, { sealed: wrongUser, name: "user" })).status).toBe(400);
    expect((await call(A, "GET", "/api/computer/machines")).json.machines).toHaveLength(1);
  });

  test("private, loopback and local hosts are refused, for create and for scan", async () => {
    for (const host of [
      "10.0.0.5",
      "127.0.0.1",
      "192.168.1.20",
      "169.254.169.254",
      "localhost",
      "db.internal",
      "printer.local",
    ]) {
      expect((await create(A, { host, name: `x ${host}` })).status).toBe(400);
      expect(
        (await call(A, "POST", "/api/computer/machines/scan", { host, port: 22 })).status,
      ).toBe(400);
    }
  });

  test("an ssh machine needs a host key the machine still offers", async () => {
    expect((await create(A, { hostKey: undefined, name: "no key" })).status).toBe(400);
    const other = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyTheMachineDoesNotOfferXXXXXXXXXXX";
    const r = await create(A, { hostKey: other, name: "wrong key" });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("HOST_KEY_CHANGED");
  });

  test("an unreadable or too short key is refused without being stored", async () => {
    const before = (
      await db.$client.query("select count(*)::int as n from connection where owner_user_id = $1", [
        A,
      ])
    ).rows[0].n;
    expect((await create(A, { name: "short" }, "not a key")).status).toBe(400);
    const after = (
      await db.$client.query("select count(*)::int as n from connection where owner_user_id = $1", [
        A,
      ])
    ).rows[0].n;
    expect(after).toBe(before);
  });

  test("a duplicate name is refused and leaves no orphan secret", async () => {
    const before = (
      await db.$client.query(
        "select count(*)::int as n from connection where owner_user_id = $1 and state = 'active'",
        [A],
      )
    ).rows[0].n;
    expect((await create(A)).status).toBe(400);
    const after = (
      await db.$client.query(
        "select count(*)::int as n from connection where owner_user_id = $1 and state = 'active'",
        [A],
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });

  test("an ftp machine takes a password and needs no host key", async () => {
    const r = await create(
      A,
      { name: "files", host: "93.184.216.35", username: "bob", botIds: [botA, botA2] },
      FTP_PASSWORD,
      "ftp",
    );
    expect(r.status).toBe(201);
    expect(r.json.machine).toMatchObject({
      kind: "ftp",
      port: 21,
      fingerprint: null,
      publicKey: null,
    });
    expect(r.text).not.toContain(FTP_PASSWORD);
  });

  test("a bot call gets the stored key and a result; the audit row has the action and no output", async () => {
    seen.length = 0;
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    const r = await machines.exec(
      actor,
      "web server",
      { type: "run", command: "id" },
      { botId: botA },
    );
    expect(r).toMatchObject({ exitCode: 0, output: "uid=1000(deploy)", machine: "web server" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.secret).toBe(PRIVATE_KEY);
    expect(seen[0]!.target).toMatchObject({
      kind: "ssh",
      host: "93.184.216.34",
      ip: "93.184.216.34",
      port: 22,
      username: "deploy",
      hostKey: HOST_KEY,
    });
    const audit = await db.$client.query(
      "select kind, outcome, detail from audit_event where owner_user_id = $1 and detail = 'machine:run'",
      [A],
    );
    expect(audit.rows).toEqual([{ kind: "tool_call", outcome: "ok", detail: "machine:run" }]);
  });

  test("what a bot is told about its machines carries no secret and no host key, and only the ones shared with it", async () => {
    expect(await machines.catalog(A, botA)).toEqual([
      { name: "web server", kind: "ssh", target: "deploy@93.184.216.34" },
      { name: "files", kind: "ftp", target: "bob@93.184.216.35" },
    ]);
    expect(await machines.catalog(A, botA2)).toEqual([
      { name: "files", kind: "ftp", target: "bob@93.184.216.35" },
    ]);
    expect(await machines.catalog(A, botB)).toEqual([]);
  });

  test("the list says which bots each machine is shared with", async () => {
    const list = (await call(A, "GET", "/api/computer/machines")).json.machines as {
      name: string;
      botIds: string[];
    }[];
    expect(list.map((m) => [m.name, m.botIds.slice().sort()])).toEqual([
      ["web server", [botA]],
      ["files", [botA, botA2].sort()],
    ]);
  });

  test("sharing is changed per machine, replaces the whole set, and a bot without a grant gets nothing", async () => {
    const id = (await call(A, "GET", "/api/computer/machines")).json.machines.find(
      (m: any) => m.name === "web server",
    ).id as string;
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    const run = (botId: string) =>
      machines.exec(actor, "web server", { type: "run", command: "id" }, { botId });

    // Moving the machine from the first bot to the second.
    const moved = await call(A, "PUT", `/api/computer/machines/${id}/bots`, { botIds: [botA2] });
    expect(moved.status).toBe(200);
    expect(moved.json.machine.botIds).toEqual([botA2]);
    seen.length = 0;
    await expect(run(botA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(seen).toHaveLength(0);
    expect((await run(botA2)).exitCode).toBe(0);
    const denied = await db.$client.query(
      "select outcome from audit_event where owner_user_id = $1 and detail = 'machine:run' and outcome = 'denied'",
      [A],
    );
    expect(denied.rows).toEqual([{ outcome: "denied" }]);

    // Another user cannot change it, and a bot of another user's is refused (the whole change, nothing half done).
    expect(
      (await call(B, "PUT", `/api/computer/machines/${id}/bots`, { botIds: [botB] })).status,
    ).toBe(404);
    expect(
      (await call(A, "PUT", `/api/computer/machines/${id}/bots`, { botIds: [botA, botB] })).status,
    ).toBe(400);
    expect(
      (await call(A, "GET", "/api/computer/machines")).json.machines.find((m: any) => m.id === id)
        .botIds,
    ).toEqual([botA2]);

    // Nobody at all, then back to the first bot.
    expect(
      (await call(A, "PUT", `/api/computer/machines/${id}/bots`, { botIds: [] })).json.machine
        .botIds,
    ).toEqual([]);
    await expect(run(botA2)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await call(A, "PUT", `/api/computer/machines/${id}/bots`, { botIds: [botA] });
    expect((await run(botA)).exitCode).toBe(0);
  });

  test("a machine made without bots is used by none until it is shared", async () => {
    const r = await create(A, { name: "private box", botIds: [] });
    expect(r.status).toBe(201);
    expect(r.json.machine.botIds).toEqual([]);
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    await expect(
      machines.exec(actor, "private box", { type: "run", command: "id" }, { botId: botA }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await call(A, "DELETE", `/api/computer/machines/${r.json.machine.id}`);
  });

  test("another user can neither see, change nor use the machine", async () => {
    expect((await call(B, "GET", "/api/computer/machines")).json.machines).toEqual([]);
    const id = (await call(A, "GET", "/api/computer/machines")).json.machines[0].id as string;
    expect((await call(B, "DELETE", `/api/computer/machines/${id}`)).status).toBe(404);
    expect((await call(B, "GET", `/api/computer/machines/${id}/public-key`)).status).toBe(404);
    const putSealed = await sealedFor(B, `machine.secret:${id}`, { secret: NEW_PRIVATE_KEY });
    expect(
      (await call(B, "PUT", `/api/computer/machines/${id}/secret`, { sealed: putSealed })).status,
    ).toBe(404);
    const b = await access.requireActive(new Headers({ "x-test-user": B }));
    await expect(
      machines.exec(b, "web server", { type: "run", command: "id" }, { botId: botB }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("replacing the key makes later calls use the new key and revokes the old secret", async () => {
    const id = (await call(A, "GET", "/api/computer/machines")).json.machines.find(
      (m: any) => m.name === "web server",
    ).id as string;
    const sealed = await sealedFor(A, `machine.secret:${id}`, { secret: NEW_PRIVATE_KEY });
    const r = await call(A, "PUT", `/api/computer/machines/${id}/secret`, { sealed });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("Y2NjYmJi");
    seen.length = 0;
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    await machines.exec(actor, id, { type: "run", command: "id" }, { botId: botA });
    expect(seen[0]!.secret).toBe(NEW_PRIVATE_KEY);
    const states = await db.$client.query(
      "select state from connection where owner_user_id = $1 and label = $2 order by created_at",
      [A, `machine:${id}`],
    );
    expect(states.rows.map((x) => x.state)).toEqual(["revoked", "active"]);
  });

  test("a failed call is audited as failed and the error does not echo the secret", async () => {
    reply = { exitCode: 7, output: "boom" };
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    const r = await machines.exec(
      actor,
      "web server",
      { type: "run", command: "false" },
      { botId: botA },
    );
    expect(r.exitCode).toBe(7);
    const rows = await db.$client.query(
      "select outcome from audit_event where owner_user_id = $1 and detail = 'machine:run' order by created_at desc limit 1",
      [A],
    );
    expect(rows.rows).toEqual([{ outcome: "failed" }]);
  });

  test("deleting a machine revokes its secret and bots can no longer reach it", async () => {
    const list = (await call(A, "GET", "/api/computer/machines")).json.machines as {
      id: string;
      name: string;
    }[];
    const id = list.find((m) => m.name === "web server")!.id;
    expect((await call(A, "DELETE", `/api/computer/machines/${id}`)).status).toBe(200);
    expect(
      (await call(A, "GET", "/api/computer/machines")).json.machines.map((m: any) => m.name),
    ).toEqual(["files"]);
    const actor = await access.requireActive(new Headers({ "x-test-user": A }));
    await expect(
      machines.exec(actor, "web server", { type: "run", command: "id" }, { botId: botA }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const active = await db.$client.query(
      "select count(*)::int as n from connection where owner_user_id = $1 and label = $2 and state = 'active'",
      [A, `machine:${id}`],
    );
    expect(active.rows[0].n).toBe(0);
  });

  test("a remote Cua computer is added with a sealed token that is stored encrypted and never returned", async () => {
    const TOKEN = "fake-remote-bearer-token-123";
    const add = async (over: Record<string, unknown> = {}, purpose = "computer.create:cua") =>
      call(A, "POST", "/api/computer/vms", {
        name: "Office Mac",
        target: "cua",
        endpoint: "https://93.184.216.34",
        sealed: await sealedFor(A, purpose, { secret: TOKEN }),
        ...over,
      });
    // A plaintext token, a token sealed for another purpose and a plain-http address are all refused.
    expect((await add({ sealed: undefined, token: TOKEN })).status).toBe(400);
    expect((await add({}, "machine.create:ssh")).status).toBe(400);
    expect((await add({ endpoint: "http://93.184.216.34" })).status).toBe(400);
    expect((await add({ endpoint: "https://10.0.0.5" })).status).toBe(400);

    const made = await add();
    expect(made.status).toBe(201);
    expect(made.json.vm).toMatchObject({
      name: "Office Mac",
      target: "cua",
      endpoint: "https://93.184.216.34",
      status: "stopped",
    });
    expect(made.text).not.toContain(TOKEN);
    const row = (
      await db.$client.query(
        "select endpoint, connection_id from computer_vm where owner_user_id = $1 and target = 'cua'",
        [A],
      )
    ).rows[0];
    expect(row.endpoint).toBe("https://93.184.216.34");
    const stored = await db.$client.query(
      "select ciphertext from connection_credential where connection_id = $1",
      [row.connection_id],
    );
    expect(Buffer.from(stored.rows[0].ciphertext).includes(TOKEN)).toBe(false);

    // Starting reads the token for this one call; the list never shows it.
    expect((await call(A, "POST", `/api/computer/vms/${made.json.vm.id}/start`)).status).toBe(200);
    expect(reached).toEqual([{ endpoint: "https://93.184.216.34", token: TOKEN }]);
    const listed = await call(A, "GET", "/api/computer/vms");
    expect(listed.text).not.toContain(TOKEN);
    expect(listed.json.vms.find((v: any) => v.target === "cua").status).toBe("running");

    // Another user can neither start nor delete it.
    expect((await call(B, "POST", `/api/computer/vms/${made.json.vm.id}/start`)).status).toBe(404);
    expect((await call(B, "DELETE", `/api/computer/vms/${made.json.vm.id}`)).status).toBe(404);

    expect((await call(A, "DELETE", `/api/computer/vms/${made.json.vm.id}`)).status).toBe(200);
    const left = await db.$client.query(
      "select count(*)::int as n from connection where id = $1 and state = 'active'",
      [row.connection_id],
    );
    expect(left.rows[0].n).toBe(0);
  });
});
