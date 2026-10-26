# Password-manager credentials for bots (1Password, Bitwarden)

Status: implemented 2026-10-26. Browser sessions are covered by unit and Postgres integration tests. The desktop-VM fill was run on a real VM (zetta-desktop image, cua-spacesd 0.8.0) by `vm-docker.test.ts`.

## Decision

Bots may sign in to websites with logins the user explicitly shares from 1Password or Bitwarden. **The model never receives a secret value.** This replaces the old rule "bots never type passwords; every sign-in page is a hand-off". A sign-in page still hands off to the user when no shared login matches the site.

## How it works

- **Plugins.** `1password` and `bitwarden` are native plugins in `apps/server/src/modules/integrations/plugins/vault/`.
  - The connection settings are sealed like any plugin config: AES-GCM in the connections store, per user.
  - The user picks one connection style per plugin:
    - 1Password **service account** (`op` CLI), or a 1Password **Connect server** (REST, following the private-address policy).
    - Bitwarden **Secrets Manager** machine account (`bws` CLI), or the **personal vault**: API key + master password through the `bw` CLI. Vaultwarden is reached through the server URL.
- **CLIs.** They run with secrets in the environment only, never in argv. Each gets a neutral cwd, a deadline and bounded output. CLI output is never echoed in errors, because listings include values; only metadata is kept.
  - The server image installs them (`apps/server/Dockerfile`, opt out with `--build-arg VAULT_CLIS=0`).
  - SDKs were not used because the server ships as a `bun build --compile` binary, where native and WASM addons are fragile.
- **Grants (allowlist).** Nothing is usable until the user shares an item in Studio > Plugins > (plugin) > Shared logins. A grant is `{item id, title, sites, fields}`.
  - It is stored inside the plugin's sealed config, so titles and sites are encrypted at rest and no migration was needed.
  - The title and default sites come from the vault, never from the browser.
  - Sites are exact hosts, or `*.example.com` for subdomains.
- **Bot surface.** Bots get one read tool, `<plugin>.list_credentials`, which returns refs, titles, sites and fields. To fill a value, a bot writes:
  ```
  zetta:credential {"ref":"1password:<item>","field":"username|password|totp","target":"browser|desktop"}
  ```
  The chat service checks, in order:
  1. Computer use is enabled for the bot, the bot is onboarded, and the action budget is not used up.
  2. The right input:
     - Browser: the DOM `activeElement` must fit. A password goes only into `input[type=password]`; a username or code needs a matching autocomplete, name or label hint.
     - Desktop: the server picks the input itself (`pickInput`), so the bot does not have to click first. A password goes into the page's `password text` element; a username into a text field labelled like one (or the one right before the password); a code into a field labelled like one. The page must not show Chromium's "Not secure" chip.
  3. `plugins.credential`: the plugin is bound to this bot, the user granted this item and field, and the page is **https** on one of the grant's sites.
  4. Only then is the value revealed. The server types it directly, and the bot gets back `filled the password for "<title>"`.

  On the desktop, steps 2–4 run as one step in the VM's action queue (`fillCredential` in `vm.ts`), so no other action can slip in between the checks and the typing. The page address comes from Chromium itself: Ctrl+L, Ctrl+C, then the VM's own clipboard is read and restored afterwards.

  A refusal is audited as `tool_call` with `outcome: denied` (`credential:<reason>`). A fill is audited as `credential:<field>`. Values are never audited.
- **Sign-in pages.** When a browser page shows a password input and a shared login matches the site, the bot is told which ref to use instead of raising the hand-off card.

## Threats considered

- **Prompt injection asks the bot to type the password elsewhere.** The origin check stops lookalike hosts and http pages. The input check stops comment boxes and search fields on the right site. The bot never holds the value, so it cannot paste it or exfiltrate it in a URL.
- **Another user's bot names your ref.** Plugins, grants and binding are per user, so the call fails with `NOT_BOUND`.
- **Leaks through logs, transcripts or tool results.** Only `browserResults` text reaches the model, and it carries no values. The accessibility read that normally follows a desktop action is skipped for fills. The integration test asserts the value is absent from prompts, replies, stored messages and audit rows.
- **Personal vault master password at rest.** It is sealed per user. Recommend a dedicated account or collection that holds only the logins bots need. Secrets Manager or a 1Password service account scoped to one vault is preferred.

## What the real VM showed (cua-spacesd 0.8.0, Chromium)

- The accessibility tree carries roles, labels and window-relative frames, plus `in_web_content` on page elements. It carries **no field values and no focus state**, in either the markdown or the `elements` format. The address bar is `entry "Address and search bar"` with no text. So the address and the focused input cannot be read from it, and the first design (parse both from the tree) could not work.
- The omnibox copy gives the exact URL (`https://github.com/login`).
- https pages show a `View site information` button described "Secure"; plain http pages show a `Not secure` button.
- `clipboard_read` errors while the VM's clipboard is still empty. This is treated as an empty clipboard.
- **Startup bug, fixed here.** Right after boot no window is active, and cua-driver refuses foreground input (`foreground_unavailable … No window is active at all`), so a bot's first action failed about half the time. `start()` now brings Chromium to the front, and any input refused that way brings it to the front and retries once.
  - After the fix, the real-VM suite passed 3 of 4 runs. The one failure was a first navigation whose driver message was not captured. Keep an eye on it.
- `vm-docker.test.ts` bind-mounts token files from the temp folder. Docker on macOS (colima/lima) does not share `/var/folders`, so set `ZETTA_VM_TOKEN_ROOT` to a folder under `$HOME` when running it there.

## Open items

- **Small race.** The page could still navigate by itself between reading the address and typing (scripts, redirects). Nothing else Zetta does can interleave on the desktop, though; on browser sessions the focus check and the typing are separate steps.
- **Not covered.** Vault secrets as environment variables for code harness runs. Per-bot grants (today grants are per user, gated by the per-bot plugin binding). Brand logos for both plugins.
