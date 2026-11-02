import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import type { Database } from "@zetta/db";
import {
  AccessError,
  createMembershipLookup,
  createIdentityAccess,
  requireOwned,
  requireOwnedChild,
} from "./access";

test("fresh session/membership resolution denies anonymous, expired, unenrolled and removed users", async () => {
  let active = true;
  const access = createIdentityAccess(
    {
      api: {
        getSession: async ({ headers }) => (headers.has("cookie") ? { user: { id: "A" } } : null),
      },
    },
    async () => (active ? { isAdmin: false } : null),
  );
  expect(await access.status(new Headers())).toEqual({ state: "anonymous" });
  await expect(access.requireActive(new Headers())).rejects.toMatchObject({
    code: "SIGN_IN_REQUIRED",
  });
  const headers = new Headers({ cookie: "fixture" });
  expect(await access.status(headers)).toEqual({ state: "active", userId: "A", isAdmin: false });
  active = false;
  expect(await access.status(headers)).toEqual({ state: "unenrolled", userId: "A" });
  await expect(access.requireActive(headers)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
});

test("owner and nested guards deny B/admin/forged actor and freeze trusted actors", async () => {
  const access = createIdentityAccess(
    { api: { getSession: async ({ headers }) => ({ user: { id: headers.get("user") ?? "" } }) } },
    async (id) => ({ isAdmin: id === "admin" }),
  );
  const resource = { id: "parent-A", ownerUserId: "A" };
  for (const id of ["A", "B", "admin"]) {
    const actor = await access.requireActive(new Headers({ user: id }));
    expect(Object.isFrozen(actor)).toBe(true);
    if (id === "A") {
      expect(requireOwned(actor, resource)).toBe(resource);
      expect(
        requireOwnedChild(actor, resource, { parentId: resource.id, ownerUserId: "A" }),
      ).toEqual({ parentId: resource.id, ownerUserId: "A" });
      expect(() =>
        requireOwnedChild(actor, resource, { parentId: "other", ownerUserId: "A" }),
      ).toThrow(AccessError);
      expect(() =>
        requireOwnedChild(actor, resource, { parentId: resource.id, ownerUserId: "B" }),
      ).toThrow(AccessError);
    } else {
      expect(() => requireOwned(actor, resource)).toThrow("Resource not found.");
      expect(() =>
        requireOwnedChild(actor, resource, { parentId: resource.id, ownerUserId: "A" }),
      ).toThrow("Resource not found.");
    }
    expect(() => requireOwned(actor, null)).toThrow("Resource not found.");
  }
  expect(() => requireOwned({ userId: "A", isAdmin: true }, resource)).toThrow(
    "Resource not found.",
  );
});

test("session and DB exceptions are opaque", async () => {
  for (const failSession of [true, false]) {
    const access = createIdentityAccess(
      {
        api: {
          getSession: async () => {
            if (failSession) throw Error("sensitive");
            return { user: { id: "A" } };
          },
        },
      },
      async () => {
        throw Error("sensitive");
      },
    );
    await expect(access.status(new Headers())).rejects.toMatchObject({
      code: "IDENTITY_UNAVAILABLE",
      message: "Unable to check access. Please retry.",
    });
  }
});

test("membership lookup binds the actor and active status with installed Drizzle", async () => {
  const { drizzle } = createRequire(import.meta.resolve("@zetta/db"))(
    "drizzle-orm/node-postgres",
  ) as {
    drizzle(options: {
      client: { query(query: { text: string }, params: unknown[]): Promise<{ rows: unknown[][] }> };
    }): Pick<Database, "select">;
  };
  const calls: Array<{ text: string; params: unknown[] }> = [];
  let rows: unknown[][] = [["A"]];
  const db = drizzle({
    client: {
      async query(query, params) {
        calls.push({ text: query.text, params });
        return { rows };
      },
    },
  });
  const lookup = createMembershipLookup(db);
  expect(await lookup("A")).toEqual({ isAdmin: true });
  expect(await lookup("B")).toEqual({ isAdmin: false });
  rows = [];
  expect(await lookup("A")).toBeNull();
  const call = calls[0];
  if (!call) throw Error("Missing query");
  expect(call.text).toContain('"zetta"."membership"."user_id" = $');
  expect(call.text).toContain('"zetta"."membership"."status" = $');
  expect(call.text).toContain('left join "zetta"."installation_identity"');
  expect(call.params).toEqual([1, "A", "active", 1]);
  expect(calls).toHaveLength(3);
});
