# Password-manager credentials for bots (1Password, Bitwarden)

Status: implemented 2026-10-26. Browser sessions are covered by unit and Postgres integration tests. The desktop-VM path was not run against a real VM (see Open items).

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
  2. The focused element is the right kind of input:
     - Browser: the DOM `activeElement`. A password goes only into `input[type=password]`; a username or code needs a matching autocomplete, name or label hint.
     - Desktop: the row the Chromium accessibility tree marks as focused.
  3. `plugins.credential`: the plugin is bound to this bot, the user granted this item and field, and the page is **https** on one of the grant's sites.
  4. Only then is the value revealed. The server types it directly, and the bot gets back `filled the password for "<title>"`.

  A refusal is audited as `tool_call` with `outcome: denied` (`credential:<reason>`). A fill is audited as `credential:<field>`. Values are never audited.
- **Sign-in pages.** When a browser page shows a password input and a shared login matches the site, the bot is told which ref to use instead of raising the hand-off card.

## Threats considered

- **Prompt injection asks the bot to type the password elsewhere.** The origin check stops lookalike hosts and http pages. The input check stops comment boxes and search fields on the right site. The bot never holds the value, so it cannot paste it or exfiltrate it in a URL.
- **Another user's bot names your ref.** Plugins, grants and binding are per user, so the call fails with `NOT_BOUND`.
- **Leaks through logs, transcripts or tool results.** Only `browserResults` text reaches the model, and it carries no values. The accessibility read that normally follows a desktop action is skipped for fills. The integration test asserts the value is absent from prompts, replies, stored messages and audit rows.
- **Personal vault master password at rest.** It is sealed per user. Recommend a dedicated account or collection that holds only the logins bots need. Secrets Manager or a 1Password service account scoped to one vault is preferred.

## Open items

- **Desktop VM.** The address bar and focus markers are parsed from cua-driver's accessibility text (`desktopPage`, `desktopFieldFits`) and fail closed when unrecognised. This was not checked against a live VM: run a real fill with `ZETTA_VM_TEST=1` and adjust the parsers to the real rows.
- **Small race.** The page could navigate between the focus/origin check and typing. Re-checking after typing needs an atomic "type if origin" primitive in the browser and VM layers.
- **Not covered.** Vault secrets as environment variables for code harness runs. Per-bot grants (today grants are per user, gated by the per-bot plugin binding). Brand logos for both plugins.
