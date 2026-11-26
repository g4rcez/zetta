import { describe, expect, test } from "bun:test";

import {
  administers,
  isInviteRole,
  mayInvite,
  refuseRoleChange,
  type RoleChange,
  WORKSPACE_SLUG,
} from "./workspace";

const change = (over: Partial<RoleChange>): RoleChange => ({
  actor: "owner",
  self: false,
  from: "member",
  to: "admin",
  owners: 2,
  targetIsRoot: false,
  ...over,
});

describe("workspace roles", () => {
  test("owners and administrators administer; a member does not", () => {
    expect([administers("owner"), administers("admin"), administers("member")]).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("an invitation never grants ownership, and an administrator invites members only", () => {
    expect(isInviteRole("owner")).toBe(false);
    expect(mayInvite("owner", "admin")).toBe(true);
    expect(mayInvite("admin", "member")).toBe(true);
    expect(mayInvite("admin", "admin")).toBe(false);
    expect(mayInvite("member", "member")).toBe(false);
  });

  test("an owner sets any role", () => {
    expect(refuseRoleChange(change({ to: "owner" }))).toBeNull();
    expect(refuseRoleChange(change({ from: "admin", to: "member" }))).toBeNull();
    expect(refuseRoleChange(change({ from: "owner", to: "member" }))).toBeNull();
  });

  test("an administrator moves people between member and administrator, and touches no owner", () => {
    expect(refuseRoleChange(change({ actor: "admin" }))).toBeNull();
    expect(refuseRoleChange(change({ actor: "admin", from: "admin", to: "member" }))).toBeNull();
    expect(refuseRoleChange(change({ actor: "admin", to: "owner" }))).toBe("not_allowed");
    expect(refuseRoleChange(change({ actor: "admin", from: "owner", to: "member" }))).toBe(
      "not_allowed",
    );
  });

  test("an administrator does not change their own role, and a member changes none", () => {
    expect(
      refuseRoleChange(change({ actor: "admin", self: true, from: "admin", to: "member" })),
    ).toBe("not_allowed");
    expect(refuseRoleChange(change({ actor: "member" }))).toBe("not_allowed");
  });

  test("a workspace keeps one owner, also when the last owner steps down", () => {
    expect(refuseRoleChange(change({ from: "owner", to: "admin", owners: 1 }))).toBe("last_owner");
    expect(refuseRoleChange(change({ self: true, from: "owner", to: "member", owners: 1 }))).toBe(
      "last_owner",
    );
    expect(refuseRoleChange(change({ from: "owner", to: "admin", owners: 2 }))).toBeNull();
  });

  test("root stays an owner, however many owners there are", () => {
    expect(
      refuseRoleChange(change({ from: "owner", to: "admin", owners: 3, targetIsRoot: true })),
    ).toBe("root_owner");
  });

  test("setting the role a person already has is said, not done", () => {
    expect(refuseRoleChange(change({ from: "admin", to: "admin" }))).toBe("unchanged");
  });

  test("a slug is lower case letters, digits and inner dashes", () => {
    for (const good of ["main", "acme-2", "a"]) expect(WORKSPACE_SLUG.test(good)).toBe(true);
    for (const bad of ["", "-acme", "Acme", "a b", "a/b", "x".repeat(64)])
      expect(WORKSPACE_SLUG.test(bad)).toBe(false);
  });
});
