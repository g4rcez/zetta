import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import type { Database } from "@zetta/db";
import { AdminLifecycleUnavailableError, createAdminLifecycleService } from "./admin-lifecycle";

// Real installed Drizzle SQL and transaction orchestration; only the offline pg
// query protocol is substituted. No Pool/DB/auth/services/env is instantiated.
type Query = { text: string; rowMode?: string };
type Call = { text: string; params: unknown[] };
const { drizzle } = createRequire(import.meta.resolve("@zetta/db"))(
  "drizzle-orm/node-postgres",
) as {
  drizzle(options: {
    client: { query(query: Query, params: unknown[]): Promise<{ rows: unknown[][] }> };
  }): Pick<Database, "transaction">;
};
type Member = {
  activationRevision: unknown;
  status: "active" | "removed";
  joinedAt: string;
  removedAt: string | null;
};
type Audit = {
  eventKind: string;
  actorKind: string;
  actorUserId: unknown;
  subjectUserId: unknown;
  invitationId: unknown;
  reason: unknown;
};
type State = {
  adminId: string | null;
  accounts: string[];
  members: Record<string, Member>;
  sessions: string[];
  audits: Audit[];
};
type Options = {
  collision?: boolean;
  auditFailure?: boolean;
  sessionFailure?: boolean;
  membershipFailure?: boolean;
  activationNoRow?: boolean;
  pointerNoRow?: boolean;
  commitFailure?: boolean;
};
const replacement = {
  expectedAdminUserId: "old",
  newAdminUserId: "new",
  reason: "Operator recovery",
};
function member(status: Member["status"] = "active", activationRevision: unknown = 1): Member {
  return {
    activationRevision,
    status,
    joinedAt: "2020-01-01",
    removedAt: status === "removed" ? "2029-01-01" : null,
  };
}
function fixture(patch: Partial<State> = {}, options: Options = {}) {
  let state: State = {
    adminId: "old",
    accounts: ["old", "new"],
    members: { old: member() },
    sessions: ["old", "old", "new", "unaffected"],
    audits: [],
    ...patch,
  };
  let snapshot = structuredClone(state);
  const calls: Call[] = [];
  const db = drizzle({
    client: {
      async query(query, params = []) {
        const text = query.text;
        calls.push({ text, params });
        let rows: unknown[][] = [];
        if (text.startsWith("begin")) snapshot = structuredClone(state);
        else if (text === "rollback") state = snapshot;
        else if (text === "commit") {
          if (options.commitFailure) throw new Error("synthetic secret commit failure");
        } else if (text.includes('from "zetta"."installation_identity"'))
          rows = state.adminId === null ? [] : [[state.adminId]];
        else if (text.includes('from "zetta"."user"'))
          rows = state.accounts.includes(String(params[0])) ? [[params[0]]] : [];
        else if (text.includes('from "zetta"."membership"')) {
          const existing = state.members[String(params[0])];
          rows = existing ? [[existing.status, existing.activationRevision]] : [];
        } else if (text.startsWith('insert into "zetta"."membership"')) {
          if (options.membershipFailure) throw new Error("synthetic secret membership failure");
          if (!options.activationNoRow) {
            const userId = String(params[0]);
            state.members[userId] = {
              activationRevision: state.members[userId] ? params[4] : params[1],
              status: "active",
              joinedAt: state.members[userId]?.joinedAt ?? "2030-01-01",
              removedAt: null,
            };
            rows = [[userId]];
          }
        } else if (text.startsWith('insert into "zetta"."installation_identity"')) {
          // Collision simulates the unique-insert error at the query boundary, NOT
          // another transaction, actual PostgreSQL uniqueness or a concurrent race.
          if (options.collision || state.adminId !== null)
            throw new Error("synthetic unique driver detail");
          if (!options.pointerNoRow) {
            state.adminId = String(params[1]);
            rows = [[state.adminId]];
          }
        } else if (text.startsWith('update "zetta"."installation_identity"')) {
          if (!options.pointerNoRow && state.adminId === params[2]) {
            state.adminId = String(params[0]);
            rows = [[state.adminId]];
          }
        } else if (text.startsWith('delete from "zetta"."session"')) {
          state.sessions = state.sessions.filter((id) => !params.includes(id));
          if (options.sessionFailure)
            throw new Error(`synthetic session driver detail ${JSON.stringify(params)}`);
        } else if (text.startsWith('insert into "zetta"."identity_audit"')) {
          state.audits.push({
            eventKind: String(params[1]),
            actorKind: String(params[2]),
            actorUserId: params[3],
            subjectUserId: params[4],
            invitationId: params[5],
            reason: params[6],
          });
          if (options.auditFailure)
            throw new Error(`synthetic audit driver detail ${JSON.stringify(params)}`);
        } else throw new Error(`Unexpected SQL in fixture: ${text}`);
        return { rows };
      },
    },
  });
  return { service: createAdminLifecycleService(db), calls, state: () => state };
}
async function denied(operation: Promise<unknown>) {
  try {
    await operation;
    throw new Error("Expected lifecycle denial");
  } catch (error) {
    expect(error).toBeInstanceOf(AdminLifecycleUnavailableError);
    expect((error as Error).message).toBe(new AdminLifecycleUnavailableError().message);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(Object.keys(error as Error).sort()).toEqual(["name"]);
  }
}
function writes(calls: Call[]) {
  return calls.filter(({ text }) => /^(insert|update|delete)/.test(text));
}

test("admin-lifecycle imports without auth/services/environment or network startup", async () => {
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Lifecycle import attempted startup"); };
    Bun.serve = forbidden;
    Bun.connect = forbidden;
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const lifecycle = await import(${JSON.stringify(new URL("./admin-lifecycle.ts", import.meta.url).href)});
    if (typeof lifecycle.createAdminLifecycleService !== "function") throw new Error("Missing service");
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const source = await Bun.file(new URL("./admin-lifecycle.ts", import.meta.url)).text();
  expect(source).toContain('import type { Database } from "@zetta/db"');
  expect(source).toContain('from "@zetta/db/query"');
  expect(source).not.toMatch(
    /from ["'][^"']*(?:services|config|env)["']|process\.env|Bun\.env|console\./,
  );
});

test("bootstrapExistingAccount explicitly selects an existing account and atomically creates active membership, singleton 1 and operator audit", async () => {
  const f = fixture({ adminId: null });
  expect(await f.service.bootstrapExistingAccount({ userId: "new" })).toEqual({
    adminUserId: "new",
  });
  expect(f.state().adminId).toBe("new");
  expect(f.state().members.new?.status).toBe("active");
  expect(f.state().audits).toEqual([
    {
      eventKind: "bootstrap",
      actorKind: "operator",
      actorUserId: null,
      subjectUserId: "new",
      invitationId: null,
      reason: null,
    },
  ]);
  expect(f.state().sessions).toEqual(["old", "old", "new", "unaffected"]);
  expect(f.calls[0]?.text).toBe("begin isolation level read committed");
  expect(f.calls[1]?.text).toContain('from "zetta"."installation_identity"');
  expect(f.calls[1]?.params).toEqual([1]);
  expect(f.calls[2]?.text).toContain('select "id" from "zetta"."user"');
  expect(f.calls[2]?.params).toEqual(["new"]);
  expect(f.calls[3]?.text).toContain('from "zetta"."membership"');
  for (const call of f.calls.slice(1, 4)) expect(call.text).toContain("for update");
  const mutation = writes(f.calls);
  expect(
    mutation.map(
      ({ text }) => text.match(/^(?:insert into|update|delete from) "zetta"\."([^"]+)"/)?.[1],
    ),
  ).toEqual(["membership", "installation_identity", "identity_audit"]);
  expect(mutation[0]?.text).toContain('where (("zetta"."membership"."status" =');
  expect(mutation[0]?.text.split("returning")[1]).toBe(' "user_id"');
  expect(mutation[0]?.params).toEqual(["new", 1, "active", null, 1, "active", null, "removed", 0]);
  expect(mutation[1]?.params).toEqual([1, "new", "active"]);
  expect(mutation[1]?.text).toContain("clock_timestamp()");
  expect(mutation[1]?.text).not.toContain("on conflict");
  expect(mutation[1]?.text.split("returning")[1]).toBe(' "admin_user_id"');
  expect(f.calls.at(-1)?.text).toBe("commit");
  expect(f.calls).toHaveLength(8);
});

test("bootstrap accepts selected active membership or explicitly reactivates removed membership without resetting joined time", async () => {
  for (const status of ["active", "removed"] as const) {
    const f = fixture({ adminId: null, members: { new: member(status) } });
    await f.service.bootstrapExistingAccount({ userId: "new" });
    expect(f.state().members.new).toEqual(member("active", status === "removed" ? 2 : 1));
    const activation = f.calls.find(({ text }) =>
      text.startsWith('insert into "zetta"."membership"'),
    );
    if (status === "active") expect(activation).toBeUndefined();
    else {
      expect(activation?.text).toContain('on conflict ("user_id") do update set');
      expect(activation?.text).toContain('where (("zetta"."membership"."status" =');
      expect(activation?.params).toContain("removed");
      expect(activation?.text.split("do update set")[1]).not.toContain('"joined_at" =');
      expect(activation?.text).toContain('"removed_at" =');
    }
  }
});

test("bootstrap missing account, existing singleton and repeated execution deny without any write", async () => {
  for (const patch of [{ adminId: null, accounts: ["old"] }, { adminId: "old" }]) {
    const f = fixture(patch);
    const before = structuredClone(f.state());
    await denied(f.service.bootstrapExistingAccount({ userId: "new" }));
    expect(f.state()).toEqual(before);
    expect(writes(f.calls)).toEqual([]);
    expect(f.calls.at(-1)?.text).toBe("rollback");
  }
  const repeated = fixture({ adminId: null });
  await repeated.service.bootstrapExistingAccount({ userId: "new" });
  const before = structuredClone(repeated.state());
  const offset = repeated.calls.length;
  await denied(repeated.service.bootstrapExistingAccount({ userId: "old" }));
  expect(repeated.state()).toEqual(before);
  expect(writes(repeated.calls.slice(offset))).toEqual([]);
});

test("bootstrap collision, audit, membership, missing write result and commit failures roll back through Drizzle with opaque errors", async () => {
  for (const options of [
    { collision: true },
    { auditFailure: true },
    { membershipFailure: true },
    { activationNoRow: true },
    { pointerNoRow: true },
    { commitFailure: true },
  ]) {
    for (const existing of [null, member("removed")]) {
      const f = fixture({ adminId: null, members: existing ? { new: existing } : {} }, options);
      const before = structuredClone(f.state());
      await denied(f.service.bootstrapExistingAccount({ userId: "new" }));
      expect(f.state()).toEqual(before);
      expect(f.calls.at(-1)?.text).toBe("rollback");
      if (!options.commitFailure) expect(f.calls.some(({ text }) => text === "commit")).toBe(false);
      if (options.collision) {
        expect(f.calls.at(-2)?.text).toContain('insert into "zetta"."installation_identity"');
        expect(
          f.calls.some(({ text }) => text.startsWith('insert into "zetta"."membership"')),
        ).toBe(true);
        expect(
          f.calls.some(({ text }) => text.startsWith('insert into "zetta"."identity_audit"')),
        ).toBe(false);
      }
    }
  }
});

test("all operations reject malformed input and extra claimed authority before opening a transaction", async () => {
  const f = fixture();
  for (const input of [
    null,
    [],
    {},
    { userId: "" },
    { userId: " new" },
    { userId: "new " },
    { userId: 1 },
    { userId: "new", isOperator: true },
    { userId: "new", role: "admin" },
    { userId: "new", actorUserId: "old" },
  ]) {
    await denied(f.service.bootstrapExistingAccount(input));
  }
  for (const input of [
    null,
    [],
    {},
    { ...replacement, newAdminUserId: "old" },
    { ...replacement, newAdminUserId: "" },
    { ...replacement, expectedAdminUserId: " old" },
    { ...replacement, expectedAdminUserId: null },
    { ...replacement, reason: "" },
    { ...replacement, reason: " \n\t" },
    { ...replacement, reason: null },
    { ...replacement, reason: 1 },
    { ...replacement, isOperator: true },
    { ...replacement, role: "admin" },
    { ...replacement, actorUserId: "old" },
    { ...replacement, ownerUserId: "old" },
  ]) {
    await denied(f.service.replaceAdminWithExistingAccount(input));
  }
  expect(f.calls).toEqual([]);
});

test("replacement locks singleton FIRST, exact old identity, then sorted accounts and memberships before activation/pointer/session/audit", async () => {
  const f = fixture();
  expect(
    await f.service.replaceAdminWithExistingAccount({
      ...replacement,
      reason: "  Operator recovery  ",
    }),
  ).toEqual({ previousAdminUserId: "old", adminUserId: "new" });
  expect(f.calls[0]?.text).toBe("begin isolation level read committed");
  expect(f.calls[1]?.text).toContain('from "zetta"."installation_identity"');
  expect(f.calls[1]?.params).toEqual([1]);
  for (const call of f.calls.slice(1, 6)) expect(call.text).toContain("for update");
  expect(f.calls.slice(2, 4).map(({ text }) => text)).toEqual([
    'select "id" from "zetta"."user" where "zetta"."user"."id" = $1 for update',
    'select "id" from "zetta"."user" where "zetta"."user"."id" = $1 for update',
  ]);
  expect(f.calls.slice(2, 4).map(({ params }) => params)).toEqual([["new"], ["old"]]);
  expect(f.calls.slice(4, 6).map(({ params }) => params)).toEqual([["new"], ["old"]]);
  for (const call of f.calls.slice(4, 6)) {
    expect(call.text).toBe(
      'select "status", "activation_revision" from "zetta"."membership" where "zetta"."membership"."user_id" = $1 for update',
    );
  }
  const mutation = writes(f.calls);
  expect(
    mutation.map(
      ({ text }) => text.match(/^(?:insert into|update|delete from) "zetta"\."([^"]+)"/)?.[1],
    ),
  ).toEqual(["membership", "installation_identity", "session", "identity_audit"]);
  expect(mutation[1]?.text).toContain(
    'where (("zetta"."installation_identity"."id" = $2) and ("zetta"."installation_identity"."admin_user_id" = $3))',
  );
  expect(mutation[1]?.params).toEqual(["new", 1, "old"]);
  expect(mutation[1]?.text).not.toContain('"bootstrapped_at" =');
  expect(mutation[1]?.text.split("returning")[1]).toBe(' "admin_user_id"');
  expect(mutation[2]?.text).toBe(
    'delete from "zetta"."session" where (("zetta"."session"."user_id" = $1) or ("zetta"."session"."user_id" = $2))',
  );
  expect(mutation[2]?.params).toEqual(["old", "new"]);
  expect(mutation[2]?.text).not.toContain("returning");
  expect(mutation[3]?.text).toContain("clock_timestamp()");
  expect(f.calls.at(-1)?.text).toBe("commit");
  expect(f.calls).toHaveLength(11);
  expect(f.state().sessions).toEqual(["unaffected"]);
  expect(f.state().members.old).toEqual(member());
  expect(f.state().adminId).toBe("new");
  expect(f.state().audits).toEqual([
    {
      eventKind: "admin-replacement",
      actorKind: "operator",
      actorUserId: null,
      subjectUserId: "new",
      invitationId: null,
      reason: "Operator recovery",
    },
  ]);
});

test("replacement locks in the same lexical order with reversed old/new roles and supports active or removed target", async () => {
  for (const status of ["active", "removed"] as const) {
    const f = fixture({ adminId: "new", members: { new: member(), old: member(status) } });
    expect(
      await f.service.replaceAdminWithExistingAccount({
        expectedAdminUserId: "new",
        newAdminUserId: "old",
        reason: "Recovery",
      }),
    ).toEqual({ previousAdminUserId: "new", adminUserId: "old" });
    expect(f.calls.slice(2, 6).map(({ params }) => params)).toEqual([
      ["new"],
      ["old"],
      ["new"],
      ["old"],
    ]);
    expect(f.state().members).toEqual({
      new: member(),
      old: member("active", status === "removed" ? 2 : 1),
    });
    const activation = f.calls.find(({ text }) =>
      text.startsWith('insert into "zetta"."membership"'),
    );
    if (status === "active") expect(activation).toBeUndefined();
    else {
      expect(activation?.text.split("do update set")[1]).not.toContain('"joined_at" =');
      expect(activation?.params).toContain("removed");
    }
    expect(
      f.calls.some(({ text }) =>
        /schedule|readiness|connection|workflow|publication|bot|owner/.test(text),
      ),
    ).toBe(false);
  }
});

test("replacement missing bootstrap, stale expected admin, missing old/new account or inactive old membership deny without mutation", async () => {
  const cases: Partial<State>[] = [
    { adminId: null },
    { adminId: "different" },
    { accounts: ["new"] },
    { accounts: ["old"] },
    { members: {} },
    { members: { old: member("removed") } },
  ];
  for (const patch of cases) {
    const f = fixture(patch);
    const before = structuredClone(f.state());
    await denied(f.service.replaceAdminWithExistingAccount(replacement));
    expect(f.state()).toEqual(before);
    expect(writes(f.calls)).toEqual([]);
    expect(f.calls.at(-1)?.text).toBe("rollback");
    if (patch.adminId !== undefined) expect(f.calls).toHaveLength(3);
  }
  const stale = fixture();
  await stale.service.replaceAdminWithExistingAccount(replacement);
  const before = structuredClone(stale.state());
  const offset = stale.calls.length;
  await denied(stale.service.replaceAdminWithExistingAccount(replacement));
  expect(stale.state()).toEqual(before);
  expect(stale.calls.slice(offset)).toHaveLength(3);
});

test("replacement activation, pointer, session, audit and commit failures roll back membership/pointer/both sessions together", async () => {
  for (const options of [
    { membershipFailure: true },
    { activationNoRow: true },
    { pointerNoRow: true },
    { sessionFailure: true },
    { auditFailure: true },
    { commitFailure: true },
  ]) {
    const f = fixture({ members: { old: member(), new: member("removed") } }, options);
    const before = structuredClone(f.state());
    await denied(f.service.replaceAdminWithExistingAccount(replacement));
    expect(f.state()).toEqual(before);
    expect(f.calls.at(-1)?.text).toBe("rollback");
    if (!options.commitFailure) expect(f.calls.some(({ text }) => text === "commit")).toBe(false);
    if (options.sessionFailure) {
      expect(f.calls.at(-2)?.text).toContain('delete from "zetta"."session"');
      expect(
        f.calls.some(({ text }) => text.startsWith('insert into "zetta"."identity_audit"')),
      ).toBe(false);
    }
    if (options.auditFailure)
      expect(f.calls.at(-2)?.text).toContain('insert into "zetta"."identity_audit"');
  }
});

test("reactivation uses INSERT1 and checked conflict revision while MAX/corruption deny before mutations", async () => {
  for (const revision of [0, -1, null, "1", 1.5, NaN, 2147483648, 2147483647]) {
    const f = fixture({ members: { old: member(), new: member("removed", revision) } });
    const before = structuredClone(f.state());
    await denied(f.service.replaceAdminWithExistingAccount(replacement));
    expect(writes(f.calls)).toEqual([]);
    expect(f.state()).toEqual(before);
  }
  for (const revision of [1, 37, 2147483646]) {
    const f = fixture({ members: { old: member(), new: member("removed", revision) } });
    await f.service.replaceAdminWithExistingAccount(replacement);
    expect(writes(f.calls)[0]?.params).toEqual([
      "new",
      1,
      "active",
      null,
      revision + 1,
      "active",
      null,
      "removed",
      revision,
    ]);
    expect(f.state().members.new?.activationRevision).toBe(revision + 1);
  }
  const active = fixture({ members: { old: member(), new: member("active", 2147483647) } });
  await active.service.replaceAdminWithExistingAccount(replacement);
  expect(active.state().members.new?.activationRevision).toBe(2147483647);
  expect(active.calls.some((c) => c.text.startsWith('insert into "zetta"."membership"'))).toBe(
    false,
  );
});
test("bootstrap exhaustion is opaque before writes and active MAX remains unchanged", async () => {
  const removed = fixture({ adminId: null, members: { new: member("removed", 2147483647) } });
  await denied(removed.service.bootstrapExistingAccount({ userId: "new" }));
  expect(writes(removed.calls)).toEqual([]);
  const active = fixture({ adminId: null, members: { new: member("active", 2147483647) } });
  await active.service.bootstrapExistingAccount({ userId: "new" });
  expect(active.state().members.new?.activationRevision).toBe(2147483647);
  expect(active.calls.some((c) => c.text.startsWith('insert into "zetta"."membership"'))).toBe(
    false,
  );
});
