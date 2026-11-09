import { designSystemPrompt } from "../artifacts/design-system";

/**
 * What a bot reads before it builds an app (`zetta:app {"action":"guide"}`). It is not in the always-on tool prompt: only a bot that is
 * about to build pays for these tokens. Everything here is generated from, or checked against, the code it describes (guide.test.ts).
 */
export const appGuide = () => `How to build an app (a page, backend tools, or both). Files:
- ui/index.html: the PAGE. Plain HTML, CSS and JavaScript, with its own ui/*.js, ui/*.ts and ui/*.css files, built when you publish. A library only by https URL from cdn.jsdelivr.net, unpkg.com or cdnjs.cloudflare.com; a bare import such as "react" is refused. ${designSystemPrompt()}
- index.ts: the BACKEND. It runs when a tool is called, in a container when the server has one, otherwise on the host after the user approves a card.

The page runs in a locked frame with no network of its own. Its only way out is window.zetta.call("tool.name", {input}), a promise that resolves with the tool's answer or rejects with {code, message}. A call that changes something shows the user a prompt first: the page may get a rejection with code DECLINED, and must show that calmly. At most 8 calls wait at once.

Backend:
  import { defineApp, query, mutation, t } from "zetta-app";
  export default defineApp({ tools: {
    todos: {
      list: query({ description: "List the to-dos", storage: { collections: ["todos"] } }, async (ctx) => ctx.storage.list("todos")),
      add: mutation({ description: "Add a to-do", input: t.object({ id: t.string(), text: t.string() }), approval: "never", storage: { collections: ["todos"], write: true } },
        async (ctx, { id, text }) => { ctx.storage.put("todos", id, { text, done: false }); return { id }; }),
    },
  } });
- query reads, mutation may change something. A mutation asks the user before it runs unless it declares approval: "never" (or {when: [{path, op, value}]}). Use "never" for what the page does on every click, and leave the default for deletes and anything hard to undo.
- Give every tool a clear description (bots read it to pick a tool). input and output are built with t.string({min,max,oneOf}), t.number, t.integer, t.boolean, t.json(), t.array(item), t.object({...}); add .optional(), .default(x), .describe(text). The server checks the input first and the output after, and drops undeclared properties.
- Tools may be nested (todos.list). Throw an Error to fail a call; set error.code to give it a code.
- Storage: declare it on the tool. collections: one set of records per person; shared: records common to everyone who may call the app; write: true on a mutation lets it change them (a query never writes). ctx.storage.get(collection,key), list(collection,{prefix,limit}), put(collection,key,value), delete(collection,key). A tool sees its own writes inside the call. Values are JSON up to 64 KB, up to 500 writes a call, 1 MB of records read by a call. What a tool writes is saved only if the call succeeds and its answer is valid.
- Never put a key or a password in a file. An app cannot reach the network from the page; the backend has no accounts yet.

Actions: create {title, description?, files, note?}; update {app, files?, remove?, title?, description?, note?} (files are added or replaced by path, the others stay); get {app}; list; archive {app}. After a publish you get the tools the server found and the version. A build or describe error comes back as the result: fix it with update. If the result says the app waits for the user's approval, nothing has run and the app does not exist yet: say so and wait.

The server shows the user a card with a preview and an Open link after every publish, so do not describe where the app is. To point at an app that already exists, put a block in your reply: \`\`\`zetta:app.linkto {"app":"<slug>"} \`\`\` (the fence line, then the JSON on its own line). It runs nothing.`;
