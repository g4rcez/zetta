import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { id, optStr, rest, str } from "./rest";

/**
 * Trello through its REST API with the person's own API key and token (https://developer.atlassian.com/cloud/trello/rest/).
 * Reads boards, lists and cards; writes create, move and comment on cards. Base address is fixed.
 */
const API = "https://api.trello.com/1";

function call(
  c: PluginContext,
  path: string,
  query: Record<string, string | undefined> = {},
  method: "GET" | "POST" | "PUT" = "GET",
) {
  const key = (c.config.apiKey ?? "").trim();
  const token = (c.config.token ?? "").trim();
  if (!key || !token)
    throw new PluginError(
      "NOT_CONFIGURED",
      "Trello has no key or token.",
      "Open the plugin and paste both.",
    );
  const q = new URLSearchParams({ key, token });
  for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, v);
  return rest({
    service: "Trello",
    url: `${API}${path}?${q}`,
    method,
    keyHint: "Create a new token at trello.com/app-key and update the plugin.",
  });
}

type Card = {
  id: string;
  name: string;
  desc?: string;
  idList?: string;
  url?: string;
  due?: string | null;
};
const card = (x: Card) => ({
  id: x.id,
  name: x.name,
  list: x.idList,
  due: x.due ?? null,
  url: x.url,
  desc: x.desc?.slice(0, 500),
});

export const trelloPlugin: PluginDef = registerPlugin({
  id: "trello",
  name: "Trello",
  description: "Read your boards and cards, create and move cards, and comment on them.",
  icon: "kanban",
  category: "productivity",
  auth: "api-key",
  docsUrl: "https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/",
  fields: [
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      kind: "password",
      help: "From trello.com/power-ups/admin (your Power-Up's API key).",
    },
    {
      key: "token",
      label: "Token",
      secret: true,
      kind: "password",
      help: "Generate it from the same page with the Token link.",
    },
  ],
  guide: () => [
    "Open trello.com/power-ups/admin and create (or open) a Power-Up to get an API key.",
    "Click Token next to the key and allow access; copy the token.",
    "Paste both here.",
  ],
  kind: "native",
  async status(c) {
    const me = (await call(c, "/members/me", { fields: "username,fullName" })) as {
      username?: string;
    };
    return { state: "connected", info: { account: me.username } };
  },
  tools: [
    {
      name: "boards",
      description: "Your open boards: id, name, url.",
      effect: "read",
      inputSchema: { type: "object", properties: {} },
      handler: async (c) =>
        (
          (await call(c, "/members/me/boards", { filter: "open", fields: "name,url" })) as {
            id: string;
            name: string;
            url: string;
          }[]
        ).map((b) => ({ id: b.id, name: b.name, url: b.url })),
    },
    {
      name: "lists",
      description: "The open lists of a board, with their cards.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { boardId: { type: "string" } },
        required: ["boardId"],
      },
      handler: async (c, a) =>
        (
          (await call(c, `/boards/${id(a, "boardId")}/lists`, {
            filter: "open",
            cards: "open",
            card_fields: "name,idList,due,url",
          })) as { id: string; name: string; cards?: Card[] }[]
        ).map((l) => ({ id: l.id, name: l.name, cards: (l.cards ?? []).slice(0, 50).map(card) })),
    },
    {
      name: "search",
      description: "Search cards by words.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      handler: async (c, a) =>
        (
          (await call(c, "/search", {
            query: str(a, "query", 200),
            modelTypes: "cards",
            cards_limit: "20",
          })) as {
            cards?: Card[];
          }
        ).cards?.map(card) ?? [],
    },
    {
      name: "create_card",
      description: "Create a card in a list.",
      inputSchema: {
        type: "object",
        properties: {
          listId: { type: "string" },
          name: { type: "string" },
          desc: { type: "string" },
          due: { type: "string" },
        },
        required: ["listId", "name"],
      },
      handler: async (c, a) =>
        card(
          (await call(
            c,
            "/cards",
            {
              idList: id(a, "listId"),
              name: str(a, "name", 500),
              desc: optStr(a, "desc", 8000),
              due: optStr(a, "due", 40),
            },
            "POST",
          )) as Card,
        ),
    },
    {
      name: "move_card",
      description: "Move a card to another list.",
      inputSchema: {
        type: "object",
        properties: { cardId: { type: "string" }, listId: { type: "string" } },
        required: ["cardId", "listId"],
      },
      handler: async (c, a) =>
        card(
          (await call(c, `/cards/${id(a, "cardId")}`, { idList: id(a, "listId") }, "PUT")) as Card,
        ),
    },
    {
      name: "comment",
      description: "Add a comment to a card.",
      inputSchema: {
        type: "object",
        properties: { cardId: { type: "string" }, text: { type: "string" } },
        required: ["cardId", "text"],
      },
      handler: async (c, a) => {
        await call(
          c,
          `/cards/${id(a, "cardId")}/actions/comments`,
          { text: str(a, "text", 4000) },
          "POST",
        );
        return "comment added";
      },
    },
  ],
});
