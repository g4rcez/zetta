import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { identityAudit, installationIdentity, invitation, membership } from "./identity";
import * as schema from "./index";

const tables = [membership, installationIdentity, invitation, identityAudit];
const dialect = new PgDialect();

function checks(table: PgTable) {
  return Object.fromEntries(
    getTableConfig(table).checks.map(({ name, value }) => {
      const query = dialect.sqlToQuery(value);
      expect(query.params).toEqual([]);
      return [name, query.sql.replace(/\s+/g, " ").trim()];
    }),
  );
}

function references(table: PgTable) {
  return getTableConfig(table).foreignKeys.map((key) => {
    const reference = key.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      table: getTableName(reference.foreignTable),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: key.onDelete,
      onUpdate: key.onUpdate,
    };
  });
}

function userReference(column: string): ReturnType<typeof references>[number] {
  return {
    columns: [column],
    table: "user",
    foreignColumns: ["id"],
    onDelete: "restrict",
    onUpdate: "restrict",
  };
}

describe("identity schema definitions (metadata, not PostgreSQL enforcement)", () => {
  test("imports the schema without environment, services, database or network startup", async () => {
    const script = `
      import net from "node:net";
      import tls from "node:tls";
      const forbidden = () => { throw new Error("Schema import attempted startup"); };
      Bun.serve = forbidden;
      Bun.connect = forbidden;
      net.Socket.prototype.connect = forbidden;
      tls.connect = forbidden;
      globalThis.fetch = forbidden;
      globalThis.setTimeout = forbidden;
      globalThis.setInterval = forbidden;
      const schema = await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
      for (const name of ["membership", "installationIdentity", "invitation", "identityAudit"]) {
        if (!schema[name]) throw new Error("Missing schema export: " + name);
      }
      console.log("isolated schema import OK");
    `;
    const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
      cwd: new URL("../../../..", import.meta.url).pathname,
      env: { NODE_ENV: "test" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: "isolated schema import OK\n",
      stderr: "",
    });

    // Close the local import graph so an uncalled service import cannot hide here.
    for (const file of ["identity.ts", "auth.ts", "index.ts"]) {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1] ?? "",
      );
      expect(imports.length).toBeGreaterThan(0);
      for (const imported of imports) {
        // Only the ORM and sibling schema files: no environment, service, database client or network code.
        expect(/^(drizzle-orm(\/pg-core)?|\.\/[a-z-]+)$/.test(imported)).toBe(true);
      }
      expect(source).not.toMatch(/import\s*\(|require\s*\(|process\.env|Bun\.env|\.listen\s*\(/);
    }
  });

  test("exports four typed tables with explicit identity inputs and timestamptz lifecycle columns", () => {
    expect(schema.membership).toBe(membership);
    expect(schema.installationIdentity).toBe(installationIdentity);
    expect(schema.invitation).toBe(invitation);
    expect(schema.identityAudit).toBe(identityAudit);
    expect(tables.map(getTableName)).toEqual([
      "membership",
      "installation_identity",
      "invitation",
      "identity_audit",
    ]);
    for (const table of tables) {
      const config = getTableConfig(table);
      expect(
        config.columns.filter((column) => column.primary).map((column) => column.name),
      ).toEqual([table === membership ? "user_id" : "id"]);
      expect(
        config.columns.some((column) =>
          /role|permission|password|session|payload/.test(column.name),
        ),
      ).toBe(false);
      for (const column of config.columns) {
        expect(column.defaultFn).toBeUndefined();
        expect(column.onUpdateFn).toBeUndefined();
        expect(column.hasDefault).toBe(
          column === installationIdentity.adminMembershipStatus ||
            column.name === "activation_revision",
        );
        if (column.name.endsWith("_at"))
          expect(column.getSQLType()).toBe("timestamp with time zone");
      }
    }
  });

  test("membership has one user row, active/removed consistency and the composite admin target", () => {
    const config = getTableConfig(membership);
    expect(config.columns.map((column) => [column.name, column.notNull])).toEqual([
      ["user_id", true],
      ["activation_revision", true],
      ["status", true],
      ["joined_at", true],
      ["removed_at", false],
      ["updated_at", true],
    ]);
    expect(membership.status.enumValues).toEqual(["active", "removed"]);
    expect(
      config.uniqueConstraints.map((key) => [key.name, key.columns.map((column) => column.name)]),
    ).toEqual([["membership_user_status_unique", ["user_id", "status"]]]);
    expect(references(membership)).toEqual([userReference("user_id")]);
    expect(checks(membership)).toEqual({
      membership_activation_revision_check:
        '"zetta"."membership"."activation_revision" between 1 and 2147483647',
      membership_status_check: '"zetta"."membership"."status" in (\'active\', \'removed\')',
      membership_removal_check:
        '("zetta"."membership"."status" = \'active\' and "zetta"."membership"."removed_at" is null) or ("zetta"."membership"."status" = \'removed\' and "zetta"."membership"."removed_at" is not null)',
    });
  });

  test("installation identity is a singleton pointer restricted to active membership, without automatic bootstrap", () => {
    expect(
      getTableConfig(installationIdentity).columns.map((column) => [column.name, column.notNull]),
    ).toEqual([
      ["id", true],
      ["admin_user_id", true],
      ["admin_membership_status", true],
      ["bootstrapped_at", true],
    ]);
    expect(installationIdentity.id.getSQLType()).toBe("integer");
    expect(installationIdentity.adminMembershipStatus.default).toBe("active");
    expect(references(installationIdentity)).toEqual([
      {
        columns: ["admin_user_id", "admin_membership_status"],
        table: "membership",
        foreignColumns: ["user_id", "status"],
        onDelete: "restrict",
        onUpdate: "restrict",
      },
    ]);
    expect(getTableConfig(installationIdentity).foreignKeys.map((key) => key.getName())).toEqual([
      "installation_identity_active_admin_fk",
    ]);
    expect(checks(installationIdentity)).toEqual({
      installation_identity_singleton_check: '"zetta"."installation_identity"."id" = 1',
      installation_identity_admin_active_check:
        '"zetta"."installation_identity"."admin_membership_status" = \'active\'',
    });
  });

  test("invitation stores only a unique token hash with account binding, expiry and paired consumption", () => {
    const config = getTableConfig(invitation);
    expect(config.columns.map((column) => [column.name, column.notNull])).toEqual([
      ["id", true],
      ["token_hash", true],
      ["intended_email", true],
      ["intended_user_id", false],
      ["issued_by_user_id", true],
      ["created_at", true],
      ["expires_at", true],
      ["revoked_at", false],
      ["consumed_at", false],
      ["consumed_by_user_id", false],
    ]);
    expect(
      config.uniqueConstraints.map((key) => [key.name, key.columns.map((column) => column.name)]),
    ).toEqual([["invitation_token_hash_unique", ["token_hash"]]]);
    expect(references(invitation)).toEqual([
      userReference("intended_user_id"),
      userReference("issued_by_user_id"),
      userReference("consumed_by_user_id"),
    ]);
    expect(checks(invitation)).toEqual({
      invitation_email_canonical_check:
        '"zetta"."invitation"."intended_email" = lower("zetta"."invitation"."intended_email")',
      invitation_expiry_check:
        '"zetta"."invitation"."expires_at" > "zetta"."invitation"."created_at"',
      invitation_consumption_check:
        '("zetta"."invitation"."consumed_at" is null) = ("zetta"."invitation"."consumed_by_user_id" is null)',
    });
  });

  test("user email must be stored in lower case", () => {
    expect(checks(user)).toEqual({
      user_email_canonical_check: '"zetta"."user"."email" = lower("zetta"."user"."email")',
    });
  });

  test("identity audit is minimal and supports a real operator without a fabricated user actor", () => {
    expect(
      getTableConfig(identityAudit).columns.map((column) => [column.name, column.notNull]),
    ).toEqual([
      ["id", true],
      ["event_kind", true],
      ["actor_kind", true],
      ["actor_user_id", false],
      ["subject_user_id", false],
      ["invitation_id", false],
      ["occurred_at", true],
      ["operator_reason", false],
    ]);
    expect(identityAudit.eventKind.enumValues).toEqual([
      "bootstrap",
      "admin-replacement",
      "invite-issued",
      "invite-revoked",
      "invite-consumed",
    ]);
    expect(identityAudit.actorKind.enumValues).toEqual(["operator", "user"]);
    expect(references(identityAudit)).toEqual([
      userReference("actor_user_id"),
      userReference("subject_user_id"),
      {
        columns: ["invitation_id"],
        table: "invitation",
        foreignColumns: ["id"],
        onDelete: "restrict",
        onUpdate: "restrict",
      },
    ]);
    expect(checks(identityAudit)).toEqual({
      identity_audit_event_kind_check:
        "\"zetta\".\"identity_audit\".\"event_kind\" in ('bootstrap', 'admin-replacement', 'invite-issued', 'invite-revoked', 'invite-consumed')",
      identity_audit_actor_kind_check:
        '"zetta"."identity_audit"."actor_kind" in (\'operator\', \'user\')',
      identity_audit_actor_check:
        '("zetta"."identity_audit"."actor_kind" = \'operator\' and "zetta"."identity_audit"."actor_user_id" is null) or ("zetta"."identity_audit"."actor_kind" = \'user\' and "zetta"."identity_audit"."actor_user_id" is not null)',
      identity_audit_replacement_reason_check:
        '"zetta"."identity_audit"."event_kind" <> \'admin-replacement\' or ("zetta"."identity_audit"."actor_kind" = \'operator\' and "zetta"."identity_audit"."operator_reason" is not null and length(btrim("zetta"."identity_audit"."operator_reason")) > 0)',
    });
  });
});

describe("activation feature offline artifacts (not executed PostgreSQL)", () => {
  test("int32 default and null-safe guard clauses preserve exact lifecycle branches", async () => {
    expect(membership.activationRevision.getSQLType()).toBe("integer");
    expect(membership.activationRevision.default).toBe(1);
    expect(membership.activationRevision.notNull).toBe(true);
    const source = await Bun.file(
      new URL(
        "../../identity-activation-test-migrations/20261022202537_identity_activation_guards/migration.sql",
        import.meta.url,
      ),
    ).text();
    expect(source).toContain("IF NEW.activation_revision IS DISTINCT FROM 1 THEN");
    expect(source).toContain("IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN");
    expect(source).toContain("IF OLD.status = 'removed' AND NEW.status = 'active' THEN");
    expect(source).toContain(
      "IF NEW.activation_revision IS DISTINCT FROM OLD.activation_revision + 1 THEN",
    );
    expect(source).toContain(
      "ELSIF NEW.activation_revision IS DISTINCT FROM OLD.activation_revision THEN",
    );
    expect(source.indexOf("IF OLD.activation_revision = 2147483647 THEN")).toBeLessThan(
      source.indexOf("OLD.activation_revision + 1"),
    );
    expect([...source.matchAll(/CONSTRAINT = '([^']+)'/g)].map((m) => m[1])).toEqual([
      "membership_activation_initial",
      "membership_activation_identity_immutable",
      "membership_activation_exhausted",
      "membership_activation_transition",
      "membership_activation_transition",
    ]);
    expect([...source.matchAll(/ERRCODE = '23514'/g)]).toHaveLength(5);
    expect(source).toContain("BEFORE INSERT OR UPDATE ON zetta.membership");
    expect(source).not.toMatch(
      /SECURITY DEFINER|\bSELECT\b|\bLOCK\b|\bPERFORM\b|EXECUTE\s+'|NEW\.\w+\s*:=|SET\s+search_path/i,
    );
    // These are SQL-binding controls: IS DISTINCT FROM denies explicit NULL rather than yielding UNKNOWN.
    expect(source).not.toMatch(/NEW\.activation_revision\s*(?:<>|!=|=)/);
  });
  test("actual migration reader applies only new ALTER and guards with immutable snapshot ancestry", async () => {
    const { readMigrationFiles } = await import("drizzle-orm/migrator");
    const { readdir } = await import("node:fs/promises");
    const folder = new URL("../../identity-activation-test-migrations/", import.meta.url);
    const names = [
      "20261022123627_identity_initial",
      "20261022202532_identity_activation_revision",
      "20261022202537_identity_activation_guards",
    ];
    expect((await readdir(folder)).sort()).toEqual(names);
    expect(await readdir(new URL(`${names[0]}/`, folder))).toEqual(["snapshot.json"]);
    for (const name of names.slice(1))
      expect((await readdir(new URL(`${name}/`, folder))).sort()).toEqual([
        "migration.sql",
        "snapshot.json",
      ]);
    expect(await Bun.file(new URL(`${names[0]}/snapshot.json`, folder)).text()).toBe(
      await Bun.file(
        new URL(
          "../../identity-test-migrations/20261022123627_identity_initial/snapshot.json",
          import.meta.url,
        ),
      ).text(),
    );
    const migrations = readMigrationFiles({ migrationsFolder: folder.pathname });
    expect(migrations.map((m) => m.name)).toEqual(names.slice(1));
    expect(migrations).toHaveLength(2);
    const ddl = migrations[0]?.sql.map((statement) => statement.trim()).join("\n") ?? "";
    expect(ddl.trim()).toBe(
      'ALTER TABLE "zetta"."membership" ADD COLUMN "activation_revision" integer DEFAULT 1 NOT NULL;\nALTER TABLE "zetta"."membership" ADD CONSTRAINT "membership_activation_revision_check" CHECK ("activation_revision" between 1 and 2147483647);',
    );
    expect(migrations.flatMap((m) => m.sql).join("\n")).not.toMatch(
      /CREATE TABLE|DROP TABLE|ALTER TABLE "(?:user|runs|run_attempts|connection|invitation|installation_identity)"/,
    );
    const snapshots: { id: string; prevIds: string[] }[] = [];
    for (const name of names)
      snapshots.push(await Bun.file(new URL(`${name}/snapshot.json`, folder)).json());
    const [baseline, delta, guards] = snapshots;
    if (!baseline || !delta || !guards) throw new Error("Missing generated snapshot");
    expect(delta.prevIds).toEqual([baseline.id]);
    expect(guards.prevIds).toEqual([delta.id]);
  });
});
