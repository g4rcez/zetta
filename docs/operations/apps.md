# Apps

An app is code you published so bots, routines and workflows can call its **tools**. You write it in the [Playground](playground.md), press **Publish**, and decide which bots may use it. A tool that changes something asks you first. Design and phases: [decisions/apps](../decisions/apps.md).

## Example: a small app

Open **Playground**, create a TypeScript playground (the entry file is `index.ts`) and write:

```ts
import { defineApp, query, mutation, t } from "zetta-app";

export default defineApp({
  tools: {
    greet: query(
      {
        description: "Say hello to someone",
        input: t.object({ name: t.string({ max: 40 }).default("world") }),
      },
      async (_ctx, { name }) => ({ message: `Hello, ${name}!` }),
    ),
    items: {
      remove: mutation(
        { description: "Remove an item", input: t.object({ id: t.string() }) },
        async (_ctx, { id }) => ({ removed: id }),
      ),
    },
  },
});
```

Save it, press **Publish** (next to Save), then open **Apps** (under More in the sidebar). The app is `apps.<slug>` where the slug comes from the title, and its tools are `apps.<slug>.greet` and `apps.<slug>.items.remove`.

### What you can declare

| In the code                       | Meaning                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query(options, handler)`         | A tool that only reads.                                                                                                                                                                                                   |
| `mutation(options, handler)`      | A tool that may change something.                                                                                                                                                                                         |
| `description`                     | What it does. Bots read this to pick a tool.                                                                                                                                                                              |
| `input`, `output`                 | Built with `t.object`, `t.string`, `t.number`, `t.integer`, `t.boolean`, `t.array`, `t.json`; add `.optional()`, `.default(x)`, `.describe(text)`. The server checks the input before the tool runs and the output after. |
| `approval`                        | `"always"`, `"never"`, or `{ when: [{ path: "n", op: "gt", value: 100 }] }` (operators: eq, neq, gt, lt, contains, exists).                                                                                               |
| `accounts`, `account.apiKey(...)` | Declared now; connecting accounts comes in a later phase. A tool that needs one cannot run yet.                                                                                                                           |
| `storage`                         | `{ collections: ["todos"], shared: ["settings"], write: true }`: what the tool may read and (a mutation only) write. See Storage below.                                                                                   |

The handler gets `(ctx, input)`; `ctx.log(...)` writes to the run's error output. An error you throw becomes the tool's failure message (set `error.code` to give it a code).

## Storage

An app can keep records between calls. A tool declares the collections it uses; the handler reads and writes them with `ctx.storage`:

```ts
const add = mutation(
  {
    description: "Add a to-do",
    input: t.object({ id: t.string(), text: t.string() }),
    storage: { collections: ["todos"], write: true },
  },
  async (ctx, { id, text }) => {
    ctx.storage.put("todos", id, { text, done: false });
    return { id };
  },
);
const list = query({ description: "List", storage: { collections: ["todos"] } }, async (ctx) =>
  ctx.storage.list("todos"),
);
```

`ctx.storage` has `get(collection, key)`, `list(collection, { prefix, limit })`, `put(collection, key, value)` and `delete(collection, key)`. Values are JSON.

- **Whose records.** `collections` hold one set per person (each caller sees only their own). `shared` collections hold one set for everyone who may call the app.
- **When it is written.** The tool gets the records with the call and the server applies what it wrote in one step, only after the answer was valid. A tool that fails, or answers something that does not match its declaration, writes nothing. A query cannot write; a tool cannot touch a collection it did not declare.
- **Limits.** 64 KB a value, 500 writes a call, 1 MB of records read by a call, 5,000 records per person (and for the shared part), 50 MB per app. Two calls at once both finish; for the same key the last one wins.
- **Data tab.** Shows each collection with its record count and size. **Delete my records** removes yours; the owner can also **Delete everyone's records** (the owner sees how many records other people hold, never their content). A new version or a rollback never touches the records.

## Asking a bot to build an app

Tell a bot what you want ("make me a to-do list I can keep"). It reads the app guide, writes the files into a playground that is yours (so you can open and change the code), and publishes it. The reply shows a chip that opens the app.

- **A page with no backend** is published at once.
- **Backend code** runs in a container when the server has one, and is published at once. Without a container it would run on the server host, which is not sandboxed: the bot's request waits on a card (press and hold to approve) and **nothing runs until you approve**. After you approve, the bot is told how it went.
- If the page or the code has an error, the bot gets it back and fixes it; you see the new version, not the failures.
- After the bot read an email or a web page, anything it wants to publish waits for one approval card, as with its other changes.
- A bot never decides who can call the app: you grant it to bots, share it with the team and set each tool's policy on the app's page.

## Who decides what runs

For every call, the first of these that applies wins:

1. **Your choice for that tool**, on the app's page: **Ask** (a card every time), **Auto** (never asks), **Block** (never runs). **Default** goes back to the next rule.
2. **What the tool declares** with `approval`.
3. **The kind**: a query runs, a mutation asks.

The person who wrote the code can never loosen what the owner set. People outside your account (an inbound chat) cannot use apps at all.

## Pages

An app can have a page. Put `ui/index.html` (and its css and scripts) in the Playground next to your tools, or use an HTML playground for an app that is only a page, then **Publish**. The **Open** tab shows it.

- The page runs in a locked frame: it can run scripts and draw, nothing else. It cannot use the network. It reaches its tools through `window.zetta.call("tool.name", { ...input })`, which returns a promise.
- Libraries load from `cdn.jsdelivr.net`, `unpkg.com` or `cdnjs.cloudflare.com` by URL; a bare `import "react"` is refused when you publish.
- A tool that changes something asks you first, in a bar above the page that shows the tool and its exact input. You can allow that tool for as long as the page stays open.
- A page may be at most 5 MB once built. A version's page never changes after publishing; **Use version N** brings an older one back.

## Bots

On the app's **Bots** tab choose which of your bots may use the app. Only those bots get the built-in `apps` tools: `apps_search`, `apps_describe`, `apps_call`. A bot calls a tool by its path. When the tool needs approval a card appears in the chat, the bot waits, and when you answer the tool runs and the bot is told the result. A bot can never answer a card. A card nobody answers expires after 24 hours, and the bot is told it did not run.

Everything a tool returns reaches the bot as untrusted data, never as an instruction.

## Versions

Each **Publish** makes an immutable version with the files and the tools they declare. The **Versions** tab lists them; **Use version N** makes an older one answer again (the code in the Playground is not touched). A call that waits for your answer runs on the version it was asked on.

## Sharing

**Share with the team** lets every member call the app's tools, each with their own history. Only you publish, change policies, roll back or archive. A team member's bots are theirs to grant.

## Limits and what is not done yet

- Backend code is TypeScript or JavaScript only. Up to 50 files, 1 MB of source, 100 tools, 100 apps per person. A call has 30 seconds.
- **The host runner is not a sandbox.** Code runs as the server user, like a bot's shell, so publish only code you trust. Set the playground to the container runner to keep it off the host; the container passes the payload on stdin and reads `result.json`, which was verified on Podman with a Debian image. The Bun image itself was not pulled here.
- Not built yet: accounts and OAuth, code mode (a program that chains tools), triggers and workflows that call tools, the outward `/api/mcp` tools, bots using apps from outside chats.
- A call from something with no chat (a routine, the gateway) cannot ask for approval yet.
