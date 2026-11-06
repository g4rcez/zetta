# Playground

A playground is saved code that people and bots run: several files, declared inputs, and a history of runs. Use it for a report or a small script that should be kept and repeatable, instead of a one-off command in a chat. Design and phases: [decisions/playground](../decisions/playground.md).

## Example: a monthly sales report

Open **Playground** (under More in the sidebar), write a title, choose **Python** and press **Create**. Then:

1. Replace `main.py` with:

   ```python
   import json
   import os
   from html import escape

   inputs = json.load(open("inputs.json"))
   month = inputs.get("month", "2026-10")
   regions = [("North", 120), ("South", 95), ("West", 143)]
   total = sum(amount for _, amount in regions)

   rows = "".join(f"<tr><td>{escape(name)}</td><td>{amount}</td></tr>" for name, amount in regions)
   os.makedirs("out", exist_ok=True)
   with open("out/report.html", "w") as f:
       f.write(f"<h1>Sales {escape(month)}</h1><table>{rows}</table><p>Total: {total}</p>")

   print(f"report for {month}: total {total}")
   ```

2. Open the **Inputs** tab on the right, type `month` in the name box, keep the type **Text** and press **Add input**. Type `2026-11` in the new field.
3. Press **Run**, or use **Cmd+Enter** (**Ctrl+Enter** on Windows and Linux) or **F9**. The **Output** tab shows `Succeeded`, the output `report for 2026-11: total 358`, and the file `report.html`, drawn as a page.
4. Change the month to `2026-12` and run again. The **Runs** tab lists both runs. Select the first one to see what it printed. **Use these files** puts the files of an old run back in the editor.

The page is laid out as an editor: the toolbar on top (Run, the title, the language, where it runs, who can see it, Save), the files on the left, and Output, Inputs and Runs on the right. The open file, the run on screen and the right tab are in the address, so a reload or a shared link shows the same view.

A run never changes the saved playground: new input values are only for that run. **Save** keeps the values on screen as the defaults of the inputs.

### What a script gets

| Where                 | What                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `inputs.json`         | The inputs of the run, as JSON, in the working folder.                                          |
| `ZETTA_INPUTS`        | The same JSON, as an environment variable.                                                      |
| `out/`                | Files written here are kept with the run. `.html` shows as a page, images inline, text as text. |
| Working folder        | A new folder for each run, holding the playground's files. It is removed when the run ends.     |
| `window.ZETTA_INPUTS` | In a browser playground (the page), the same inputs.                                            |

## Example: ask a bot

In a chat with a bot that has code access:

> Make me a playground that prints the first ten squares, and run it.

The bot writes a block like this, and the server answers with the id:

````
```zetta:playground
{"action":"create","title":"Squares","language":"python",
 "files":[{"path":"main.py","content":"print([n * n for n in range(1, 11)])\n"}]}
```
````

The next block runs it. The reply shows a link, “created Squares”, that opens `/playground/<id>`. What the run printed goes back to the bot as untrusted data, so it can describe the result but never follows instructions found in it.

```zetta:playground
{"action":"run","id":"<id>","inputs":{}}
```

Actions: `create`, `edit` (any field; `files` replaces all files), `run` (optional `inputs` and `timeoutSeconds` up to 120), `get` (files and the last run) and `list`.

Rules that protect you:

- A bot **without code access** can create and edit a playground, but not run it on the server. You press **Run**.
- After a bot read outside content (a page, an email, a file), `create`, `edit` and `run` wait for one **Approve** card.
- A turn started by outside people (an inbound channel) cannot create or run playgrounds.
- A playground cannot hold a key or a token. The server refuses files that look like one.

## Example: a page that runs in the browser

Choose **HTML** (or TypeScript with **Browser** under _Runs on_). Press **Preview**: the server bundles the files into one page and shows it in a frame with no access to Zetta (no cookies, no API). The **Console** panel lists what the page logs.

`index.html`:

```html
<!doctype html>
<html>
  <body>
    <p id="out"></p>
    <script type="module" src="src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:

```ts
import { say } from "./say";

document.getElementById("out")!.textContent = say(window.ZETTA_INPUTS.who);
console.log("done");
```

`src/say.ts`:

```ts
export const say = (who: string): string => `hi ${who}`;
```

A page may import only its own files, or a library from a public URL such as `https://cdn.jsdelivr.net/npm/...`. A bare package name (`import x from "lodash"`) is refused.

## Where code runs

| Runner      | What it is                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server host | The default. The CLI of the language runs on the server in a new folder, with a clean environment. **Not a sandbox:** it runs as the server user, like a bot's Bash.                  |
| Container   | One long-lived container per CLI (`bun` serves TypeScript and JavaScript). No capabilities, read-only root, memory, CPU and process limits. Runs of one language share the container. |
| Browser     | The page runs it in a sandboxed frame. The server only builds it.                                                                                                                     |

Any active member can use the server host runner, as members can already create bots that run commands. If the host lacks the CLI (`bun`, `python3` or `bash`), the playground page says so and offers the other runners.

## Set up the container runner

It turns on when the container engine binary exists. The first run of a language pulls its image.

| Variable                       | Default                                                     | Meaning                                                                     |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ZETTA_DOCKER_BIN`             | `docker`                                                    | The engine (`docker` or `podman`).                                          |
| `ZETTA_PLAYGROUND_DIR`         | `~/.zetta/playground`                                       | Run folders. With Podman, keep it under a folder the Podman machine shares. |
| `ZETTA_PLAYGROUND_MEMORY`      | `1g`                                                        | Memory of each language container.                                          |
| `ZETTA_PLAYGROUND_CPUS`        | `2`                                                         | CPUs of each language container.                                            |
| `ZETTA_PLAYGROUND_PIDS`        | `256`                                                       | Processes of each language container.                                       |
| `ZETTA_PLAYGROUND_NETWORK`     | the engine's default                                        | `none` closes the network.                                                  |
| `ZETTA_PLAYGROUND_IMAGE_<BIN>` | `oven/bun:1.3.14`, `python:3.13-slim`, `debian:trixie-slim` | Another image for `BUN`, `PYTHON3` or `BASH`.                               |

Containers are named `zetta-playground-<cli>`. The server removes them, and leftover run folders, when it starts.

To check it on your machine, run the opt-in test: `ZETTA_DOCKER_TEST=1 ZETTA_DOCKER_BIN=docker bun test src/modules/playground/runner-container.test.ts` in `apps/server` (on a Mac with Podman, see `running-gated-container-tests-on-podman` in the project notes for the shim and `TMPDIR`).

## Limits

| What                    | Limit                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Files in a playground   | 50, with 1 MB of source in all                               |
| A run                   | 30 s (up to 120 s from a bot's `timeoutSeconds`)             |
| Runs at once            | 2 for a person, 4 on the server; more is refused, not queued |
| Printed output kept     | the last 64 KB of stdout and of stderr                       |
| Files in `out/`         | 50 files, 5 MB in all                                        |
| Runs kept               | the last 20 of each playground                               |
| Playgrounds of a person | 200                                                          |

## Sharing

A playground is private. Set **Who can see it** to _The team_ and every member can read it, run it and fork it into a private copy. Only the owner edits. A run by someone else belongs to the playground: the owner sees it in the history too.
