import { describe, expect, test } from "bun:test";
import { applyPlan, parseInboundCard, reachLabel } from "./inbound-card-data";

const card = {
  plugin: "whatsapp",
  pluginName: "WhatsApp",
  botId: "b1",
  botName: "Zetta",
  settings: [
    {
      key: "hookUrl",
      label: "Zetta address",
      from: "",
      to: "http://host.docker.internal:3000",
    },
  ],
  incoming: { state: "on", filter: { direct: true, groups: false, chats: [] } },
};
const read = (v: unknown) => parseInboundCard(JSON.stringify(v));

describe("parseInboundCard", () => {
  test("reads a card built by the server", () => {
    expect(read(card)).toEqual(card as never);
  });

  test("keeps the bot that is replaced", () => {
    expect(
      read({ ...card, incoming: { ...card.incoming, replaces: "Support" } })?.incoming?.replaces,
    ).toBe("Support");
  });

  test("a settings-only card and a route-only card are fine; an empty one is not", () => {
    expect(read({ ...card, incoming: undefined })?.incoming).toBeUndefined();
    expect(read({ ...card, settings: [] })?.settings).toEqual([]);
    expect(read({ ...card, settings: [], incoming: undefined })).toBeUndefined();
  });

  test("rejects a bad plugin id, a missing bot, a bad setting key, an empty new value and a bad route", () => {
    expect(read({ ...card, plugin: "../x" })).toBeUndefined();
    expect(read({ ...card, botId: "" })).toBeUndefined();
    expect(read({ ...card, settings: [{ ...card.settings[0], key: "a-b" }] })).toBeUndefined();
    expect(read({ ...card, settings: [{ ...card.settings[0], to: "" }] })).toBeUndefined();
    expect(
      read({ ...card, incoming: { state: "maybe", filter: card.incoming.filter } }),
    ).toBeUndefined();
    expect(read({ ...card, incoming: { state: "on", filter: { direct: "yes" } } })).toBeUndefined();
    expect(parseInboundCard("{nope")).toBeUndefined();
  });
});

describe("reachLabel", () => {
  test("says who may start a turn", () => {
    expect(reachLabel({ direct: true, groups: false, chats: [] })).toBe("direct chats only");
    expect(reachLabel({ direct: false, groups: true, chats: [] })).toBe("groups only");
    expect(reachLabel({ direct: true, groups: true, chats: [] })).toBe("direct chats and groups");
    expect(reachLabel({ direct: true, groups: false, chats: ["5511900000000"] })).toBe(
      "only 1 chosen chat",
    );
  });
});

describe("applyPlan", () => {
  test("is exactly what the card shows", () => {
    expect(applyPlan(read(card)!)).toEqual({
      settings: { hookUrl: "http://host.docker.internal:3000" },
      route: { enabled: true, filter: { direct: true, groups: false, chats: [] } },
    });
    expect(applyPlan(read({ ...card, incoming: undefined })!).route).toBeUndefined();
  });
});

import { sameFilter } from "./inbound-card-data";

test("two filters with the same fields are the same, whatever order the database listed them in", () => {
  expect(
    sameFilter(
      { direct: true, groups: false, chats: ["a", "b"] },
      JSON.parse('{"chats":["a","b"],"direct":true,"groups":false}'),
    ),
  ).toBe(true);
  expect(
    sameFilter(
      { direct: true, groups: false, chats: [] },
      { direct: true, groups: true, chats: [] },
    ),
  ).toBe(false);
  expect(
    sameFilter(
      { direct: true, groups: false, chats: ["a"] },
      { direct: true, groups: false, chats: [] },
    ),
  ).toBe(false);
});
