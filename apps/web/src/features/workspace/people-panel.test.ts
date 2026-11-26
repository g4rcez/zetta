import { expect, test } from "bun:test";

import { rolesFor } from "./people-panel";
import type { WorkspacePerson } from "./workspace-api";

const person = (over: Partial<WorkspacePerson>): WorkspacePerson => ({
  userId: "u",
  name: "U",
  email: "u@example.invalid",
  avatar: null,
  title: "",
  role: "member",
  isRoot: false,
  isYou: false,
  joinedAt: "2030-01-01T00:00:00.000Z",
  chief: null,
  ...over,
});

test("only the roles the server would accept are offered, the current one among them", () => {
  expect(rolesFor("owner", person({}), 1)).toEqual(["owner", "admin", "member"]);
  expect(rolesFor("admin", person({}), 1)).toEqual(["admin", "member"]);
  expect(rolesFor("admin", person({ role: "admin" }), 1)).toEqual(["admin", "member"]);
});

test("a row nobody may change offers nothing", () => {
  expect(rolesFor("member", person({}), 1)).toEqual([]);
  expect(rolesFor("admin", person({ role: "owner" }), 2)).toEqual([]);
  expect(rolesFor("admin", person({ role: "admin", isYou: true }), 1)).toEqual([]);
  // Root, and the last owner.
  expect(rolesFor("owner", person({ role: "owner", isRoot: true }), 3)).toEqual([]);
  expect(rolesFor("owner", person({ role: "owner", isYou: true }), 1)).toEqual([]);
});

test("an owner who is not the last one may step down", () => {
  expect(rolesFor("owner", person({ role: "owner", isYou: true }), 2)).toEqual([
    "owner",
    "admin",
    "member",
  ]);
});
