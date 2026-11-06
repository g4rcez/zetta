import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configureHomeAssistant } from "../integrations/plugins/homeassistant";
import type { PluginContext } from "../integrations/plugins/registry";
import { createRoutinePollers } from "./routine-pollers";

/** A fake Home Assistant on loopback: the real external boundary of the poller. */
let light = { state: "off", last_changed: "2026-11-05T10:00:00+00:00" };
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("authorization") !== "Bearer good-token")
      return new Response("no", { status: 401 });
    if (url.pathname === "/api/states/light.kitchen")
      return Response.json({
        entity_id: "light.kitchen",
        attributes: { friendly_name: "Kitchen light" },
        ...light,
      });
    return new Response("nope", { status: 404 });
  },
});
const ctx = (token = "good-token"): PluginContext => ({
  userId: "u1",
  config: { baseUrl: `http://127.0.0.1:${server.port}`, token },
  async setConfig() {},
});

describe("polling a Home Assistant entity", () => {
  beforeAll(() => configureHomeAssistant({ allowPrivate: true }));
  afterAll(() => server.stop(true));
  beforeEach(() => {
    light = { state: "off", last_changed: "2026-11-05T10:00:00+00:00" };
  });
  const poll = createRoutinePollers(async () => ctx()).home_assistant;
  const filter = { entityId: "light.kitchen" };

  test("the first poll fires nothing and remembers the state", async () => {
    const first = await poll("u1", filter, null);
    expect(first.events).toEqual([]);
    expect(first.cursor).toMatchObject({ state: "off" });
  });

  test("a change fires one event keyed by when it changed, and a repeat poll fires nothing", async () => {
    const first = await poll("u1", filter, null);
    light = { state: "on", last_changed: "2026-11-05T10:05:00+00:00" };
    const changed = await poll("u1", filter, first.cursor);
    expect(changed.events).toEqual([
      {
        key: "ha:light.kitchen:2026-11-05T10:05:00+00:00",
        event: {
          source: "home_assistant",
          entityId: "light.kitchen",
          name: "Kitchen light",
          from: "off",
          to: "on",
          changedAt: "2026-11-05T10:05:00+00:00",
        },
      },
    ]);
    expect((await poll("u1", filter, changed.cursor)).events).toEqual([]);
  });

  test("with a target state, only a change to that state fires", async () => {
    const first = await poll("u1", { ...filter, to: "on" }, null);
    light = { state: "unavailable", last_changed: "2026-11-05T10:01:00+00:00" };
    const other = await poll("u1", { ...filter, to: "on" }, first.cursor);
    expect(other.events).toEqual([]);
    light = { state: "on", last_changed: "2026-11-05T10:02:00+00:00" };
    expect((await poll("u1", { ...filter, to: "on" }, other.cursor)).events).toHaveLength(1);
  });

  test("a cursor from before a long gap fires nothing", async () => {
    light = { state: "on", last_changed: "2026-11-05T10:05:00+00:00" };
    const gap = await poll("u1", filter, { at: Date.now() - 7_200_000, state: "off" });
    expect(gap.events).toEqual([]);
    expect(gap.cursor).toMatchObject({ state: "on" });
  });

  test("a rejected token and an unknown entity fail with a reason", async () => {
    const bad = createRoutinePollers(async () => ctx("wrong")).home_assistant;
    await expect(bad("u1", filter, null)).rejects.toMatchObject({
      code: "NEEDS_AUTH",
      safe: "Home Assistant rejected the access token.",
    });
    await expect(poll("u1", { entityId: "light.nowhere" }, null)).rejects.toMatchObject({
      code: "HA_ERROR",
    });
  });
});
