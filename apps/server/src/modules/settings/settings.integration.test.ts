// The settings against a real database: the table's own rules (one row per key and scope, the installation scope included), the import
// with several processes at once, an organization override with synthetic workspace ids, and the audit line.
import { uuidv7 } from "@zetta/core/uuid";
import { createDb } from "@zetta/db";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSettingsStore } from "./store";
import { importEnvSettings } from "./import-env";
import { createSettingsService } from "./service";
import { audit } from "../features/audit";
import type { ActiveActor } from "../identity/access";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite =
  url && (url.endsWith("/zetta_test") || process.env.ZETTA_TEST_DB === "embedded")
    ? describe
    : describe.skip;
const ADMIN = `settings-admin-${uuidv7().slice(-8)}`;
const admin = Object.freeze({ userId: ADMIN, isAdmin: true }) as ActiveActor;
const ORG_A = uuidv7();
const ORG_B = uuidv7();

suite("settings on the database", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const settings = createSettingsService({
    db,
    ttlMs: 0,
    audit: (userId, c) =>
      void audit(db, userId, {
        kind: "setting",
        outcome: "ok",
        subjectId: c.key,
        detail: `${c.change}${c.scope === "organization" ? ":org" : ""}`,
      }),
  });
  const clear = () => db.$client.query("delete from setting");

  beforeAll(async () => {
    await db.$client.query(
      `insert into "user" (id, name, email) values ($1, $1, $2) on conflict do nothing`,
      [ADMIN, `${ADMIN}@example.invalid`],
    );
    await clear();
  });
  afterAll(async () => {
    await clear();
    await db.$client.query("delete from audit_event where owner_user_id = $1", [ADMIN]);
    await db.$client.query(`delete from "user" where id = $1`, [ADMIN]);
    await db.$client.end();
  });

  test("set, get, list with sources, reset", async () => {
    await clear();
    expect(await settings.get("harnessMax")).toBe(8);
    await settings.set(admin, "harnessMax", 12, { via: "person" });
    expect(await settings.resolve("harnessMax")).toEqual({ value: 12, source: "installation" });
    // The same key saved again replaces the row: the null scope counts as one scope.
    await settings.set(admin, "harnessMax", 13, { via: "person" });
    const rows = await db.$client.query(
      "select value, updated_by from setting where key = 'harnessMax'",
    );
    expect(rows.rows).toEqual([{ value: 13, updated_by: ADMIN }]);
    const { settings: all } = await settings.list(admin);
    expect(all.find((s) => s.key === "harnessMax")).toMatchObject({
      value: 13,
      source: "installation",
    });
    await settings.unset(admin, "harnessMax", { via: "person" });
    expect(await settings.get("harnessMax")).toBe(8);
    expect((await db.$client.query("select 1 from setting")).rowCount).toBe(0);
  });

  test("an organization override and a narrow refusal, with synthetic workspace ids", async () => {
    await clear();
    await settings.set(admin, "claudeLiveInput", "off", { via: "person", organizationId: ORG_A });
    expect(await settings.get("claudeLiveInput", { organizationId: ORG_A })).toBe("off");
    expect(await settings.get("claudeLiveInput", { organizationId: ORG_B })).toBe("on");
    expect(await settings.get("claudeLiveInput")).toBe("on");
    await settings.set(admin, "artifactsQuota", 1000, { via: "person" });
    await settings.set(admin, "artifactsQuota", 10, { via: "person", organizationId: ORG_A });
    expect(await settings.get("artifactsQuota", { organizationId: ORG_A })).toBe(10);
    await expect(
      settings.set(admin, "artifactsQuota", 2000, { via: "person", organizationId: ORG_B }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const scopes = await db.$client.query(
      "select scope_kind, scope_id, key from setting order by key, scope_kind",
    );
    expect(scopes.rows.length).toBe(3);
    // The organization's reset keeps the installation row.
    await settings.unset(admin, "artifactsQuota", { via: "person", organizationId: ORG_A });
    expect(await settings.get("artifactsQuota", { organizationId: ORG_A })).toBe(1000);
    expect(await settings.get("artifactsQuota")).toBe(1000);
  });

  test("a hand-edited row that is not valid is ignored, not fatal", async () => {
    await clear();
    const warnings: string[] = [];
    const quiet = createSettingsService({ db, ttlMs: 0, warn: (m) => warnings.push(m) });
    await db.$client.query(
      `insert into setting (scope_kind, scope_id, key, value) values ('installation', null, 'harnessMax', '"lots"'::jsonb)`,
    );
    expect(await quiet.get("harnessMax")).toBe(8);
    expect(warnings.length).toBe(1);
  });

  test("the change is audited with the key and never the value", async () => {
    await clear();
    await db.$client.query("delete from audit_event where owner_user_id = $1", [ADMIN]);
    await settings.set(admin, "artifactsQuota", 12345, { via: "person" });
    await settings.set(admin, "claudeLiveInput", "off", { via: "person", organizationId: ORG_A });
    await settings.unset(admin, "artifactsQuota", { via: "person" });
    // The audit write is not awaited by the service: give it a moment.
    for (let i = 0; i < 50; i++) {
      const n = (
        await db.$client.query(
          "select 1 from audit_event where owner_user_id = $1 and kind = 'setting'",
          [ADMIN],
        )
      ).rowCount;
      if (n === 3) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const rows = (
      await db.$client.query(
        "select kind, outcome, subject_id, detail from audit_event where owner_user_id = $1 order by created_at, detail",
        [ADMIN],
      )
    ).rows;
    expect(rows.length).toBe(3);
    expect(rows.map((r) => `${r.subject_id}:${r.detail}`).sort()).toEqual(
      ["artifactsQuota:reset", "artifactsQuota:set", "claudeLiveInput:set:org"].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain("12345");
  });

  describe("import for upgraders", () => {
    const env = {
      ZETTA_HARNESS_MAX: "12",
      ZETTA_LIGHT_RUNS: "on",
      ZETTA_VM_DRIVERS: "cua,agent-desktop",
    };

    test("values are imported once; an existing row is not overwritten; running twice changes nothing", async () => {
      await clear();
      await settings.set(admin, "lightRuns", "off", { via: "person" });
      const logs: string[] = [];
      const first = await importEnvSettings({ db, env, log: (m) => logs.push(m) });
      expect(first.imported.map((i) => i.key).sort()).toEqual(["harnessMax", "vmDrivers"]);
      expect(await settings.get("lightRuns")).toBe("off");
      expect(await settings.resolve("harnessMax")).toEqual({ value: 12, source: "imported" });
      expect(
        (await db.$client.query("select updated_by from setting where key = 'harnessMax'")).rows,
      ).toEqual([{ updated_by: null }]);
      const second = await importEnvSettings({ db, env, log: (m) => logs.push(m) });
      expect(second.imported).toEqual([]);
      expect(logs.length).toBe(2);
      expect((await db.$client.query("select 1 from setting")).rowCount).toBe(3);
    });

    test("an unusable value is skipped and the default stays", async () => {
      await clear();
      const warnings: string[] = [];
      const result = await importEnvSettings({
        db,
        env: { ZETTA_HARNESS_MAX: "lots", ZETTA_ROOM_CONCURRENCY: "4" },
        warn: (m) => warnings.push(m),
        log: () => {},
      });
      expect(result.imported.map((i) => i.key)).toEqual(["roomConcurrency"]);
      expect(result.skipped.map((s) => s.key)).toEqual(["harnessMax"]);
      expect(await settings.get("harnessMax")).toBe(8);
    });

    test("several processes starting at once import each value exactly once", async () => {
      await clear();
      const all = {
        ZETTA_HARNESS_MAX: "12",
        ZETTA_LIGHT_RUNS: "on",
        ZETTA_VM_DRIVERS: "cua",
        ZETTA_ROOM_CONCURRENCY: "3",
        ZETTA_CODE_ACCESS: "off",
      };
      const results = await Promise.all(
        Array.from({ length: 6 }, () => importEnvSettings({ db, env: all, log: () => {} })),
      );
      const imported = results.flatMap((r) => r.imported.map((i) => i.key)).sort();
      expect(imported).toEqual([
        "codeAccess",
        "harnessMax",
        "lightRuns",
        "roomConcurrency",
        "vmDrivers",
      ]);
      expect((await db.$client.query("select 1 from setting")).rowCount).toBe(5);
    });

    test("the store writes nothing when a row exists, and reports whether it wrote", async () => {
      await clear();
      const store = createSettingsStore(db);
      expect(await store.insertMissing({ kind: "installation" }, "harnessMax", 9)).toBe(true);
      expect(await store.insertMissing({ kind: "installation" }, "harnessMax", 10)).toBe(false);
      expect(
        await store.insertMissing({ kind: "workspace", id: ORG_A }, "claudeLiveInput", "off"),
      ).toBe(true);
      expect(
        await store.insertMissing({ kind: "workspace", id: ORG_A }, "claudeLiveInput", "on"),
      ).toBe(false);
      expect(await store.remove({ kind: "installation" }, "harnessMax")).toBe(true);
      expect(await store.remove({ kind: "installation" }, "harnessMax")).toBe(false);
    });
  });
});
