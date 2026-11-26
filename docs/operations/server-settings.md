# Where settings live

Zetta's rule: **only the host is configured through the environment.** A variable is for something the database cannot know or cannot be asked before it is reachable. Everything else, such as product switches, limits, quotas, model choices, the address of an outside service and keys, lives in the database and is changed in Studio, with no restart.

`docs/operations/settings.md` is generated from the `.env.schema` files and lists the variables. This page says which settings are _not_ variables any more and how they work.

## What stays in the environment, and why

- **Bootstrap:** needed before the database can be reached: the database address, the keys that seal secrets, where to listen (host, port, TLS files), the public address of the server, the data directory.
- **The host:** facts about the machine: the container engine and the CPU and memory limits of its containers, the folders things are kept in, the proxy header that carries the client address, the process role, the instance name, build metadata, timers of the process.

The list is `HOST_ENV` in `packages/core/src/host-env.ts`, each with a one-line reason. A test (`host-env.test.ts`, in the unit tests CI runs on every push) scans the source of the server, the web app, the CLI and the packages, and fails when the code reads a name that is not on it. It also fails when a `.env.schema` declares a name that is on no list. `MIGRATING` in the same file is **empty and must stay empty**: it held the names the program that moved settings into the database had still to remove, and the test now fails if it has any entry. A new product setting is never added to it. The scan cannot see a name built at run time (`process.env[name]`; those are listed one by one), a variable that a child process reads by itself, or anything under `apps/desktop`, which sets variables for its own processes.

To add a setting, do not add a variable: add an entry to the registry.

## What lives in the database

One table, `zetta.setting`: `scope_kind` (`installation` or `workspace`), `scope_id` (empty for the installation), `key`, `value` (JSON), `updated_by`, `updated_at`. One row per key and scope; there is no foreign key on `scope_id` yet, because the workspace table of `docs/decisions/workspaces.md` does not exist. A missing row means the default.

The registry, `packages/core/src/settings.ts`, says which keys exist: the group, the label and the help text in plain words (Studio is generated from them), the type (a switch is the text `on` or `off`, never a true/false; a whole number with its range; text; a list; a choice), the default, the scope, how an organization combines, whether it is sensitive, and the legacy variable it replaces. **A default is what the code used when the variable was unset**, so an install that never set a variable behaves as before.

Secrets are not settings. A key is a sealed connection (like the speech, mail and phone keys); it is never in this table and never imported from the environment.

## Scopes and how a value is chosen

A setting is `installation` (one value for the server) or `organization` (an installation value that an organization, i.e. a workspace, may have its own value for). The value that counts is, in order: the organization's, then the installation's, then the default. An organization-scoped setting combines in one of two ways:

- `override`: the organization's value wins.
- `narrow`: the organization may only be **stricter**: a lower number, a capability turned off, fewer entries in a list. A looser value is refused when it is saved, and ignored if the installation value is lowered afterwards. This is how an organization can never raise a limit or switch on something the server turned off.

Only the installation scope is used today. Overrides can be saved and read already (the tests use synthetic workspace ids), and the Studio page shows them once workspaces exist.

## Who changes a setting

The person who set the server up (root) changes every setting. Another owner or administrator of the workspace changes the settings of scope `organization` that are not sensitive; a setting of scope `installation` and every sensitive setting is shown to them as read-only, and the server refuses the change (`403`). A workspace has no value of its own yet: what an administrator saves is stored as the server's value, which is the one every reader takes. The roles are in [workspace-people.md](workspace-people.md).

## Sensitive settings

A setting marked sensitive is security policy: `allowPrivateNetwork` (the server may call addresses on your own network), `codeAccess` (bots may run code), `hostRunner` (playgrounds and apps may run on the server itself), `serverLogin` (people with no agent account of their own run on the server's own sign-in), `mcpAllowlist` and `mcpMemberStdio` (local commands run as the server's user), `hostSkills` (the server user's own skills folders). **Only a person changes them**, never a bot or an MCP client: the service refuses a write that comes in as a bot. Studio marks them with a warning. Every change, sensitive or not, is an administrator's and is written to the audit trail with the key and the scope, never the value.

## Importing what an upgrader had

At every start, for each setting whose legacy variable is set and which has no stored installation value, the server stores the value once (as the old code understood it: `ZETTA_LIGHT_RUNS=on`, `ZETTA_MCP_MEMBER_STDIO=1`, a number from digits). The values come from the process environment, which the `varlock run` that starts the server fills from the `.env` file for every name the schema declares (it also passes names the schema does not declare) and logs one line: `setting <key> imported from <ENV>; it now lives in the database: remove the variable`. Its source in Studio is **imported** until an administrator saves it. A value that cannot be used is skipped with a warning and the default stays. A secret is never imported: `ZETTA_WAHA_API_KEY` only makes the server log a warning that says where to save the key. It never overwrites a stored value, it is safe when several instances start together, and a missing table (a migration that has not run) only logs a warning. The import is removed after one release.

## Upgrading: variables that were removed

Some variables only repeated a value the database already holds, or were a fallback behind a sealed key. The code no longer reads them. What happens to each one at the first start after an upgrade (the log line says which variable to remove):

| Variable                                                                             | What the server does with it                                                                                                                                                                                                                                              | Where the value lives now                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ZETTA_TRANSCRIBE=off`                                                               | **Imported once**: becomes the speech-to-text provider `off`, only while the provider still holds its default (`local`). Any other value is ignored.                                                                                                                      | Studio > Voice > Speech to text, choice **Off** (`transcribe_provider`)                                                       |
| `ZETTA_SPEECH_LOCAL=off`                                                             | **Imported once**: where the text-to-speech provider is `local`, it becomes `off`. Otherwise ignored (a provider other than `local` already means the local voice is not used).                                                                                           | Studio > Voice > Text to speech (`speech_provider`)                                                                           |
| `ZETTA_TRANSCRIBE_MODEL`, `ZETTA_TRANSCRIBE_LANGUAGE`                                | **Imported once** while the field is empty and the provider is `local`, when the value is a valid Hugging Face repository (`owner/name`) or a known language.                                                                                                             | The **Model** and **Language** fields of Studio > Voice > Speech to text                                                      |
| `ZETTA_SPEECH_MODEL`                                                                 | **Imported once** while the **Model** field is empty and the text-to-speech provider is `local`, when it is a valid repository.                                                                                                                                           | The **Model** field of Studio > Voice > Text to speech                                                                        |
| `ZETTA_TRANSCRIBE_API_KEY`, `ZETTA_SPEECH_API_KEY`                                   | **Ignored, never imported** (a secret needs an administrator who owns it). The server logs a warning at start while one is still set. If nothing else was saved, there is no key: speech to text or text to speech with a provider answers that the key is not available. | Save the key in Studio > Voice (Speech to text / Text to speech) (sealed connection)                                          |
| `GOOGLE_OAUTH_REDIRECT_BASE`, `REDDIT_OAUTH_REDIRECT_BASE`, `COMPOSIO_REDIRECT_BASE` | **Removed**, no effect and no import. They were copies of `ZETTA_OAUTH_REDIRECT_BASE`.                                                                                                                                                                                    | `ZETTA_OAUTH_REDIRECT_BASE` (the public address of OAuth callbacks, else `ZETTA_SERVER_URL`): one variable for every provider |

The import writes the **installation settings row** (not the `setting` table), once per value, and never over a choice an administrator made. The one thing it cannot tell is an administrator who deliberately picks the default again while the old variable is still set: remove the variable after the first start, as the log line says, so the stored value is the only source. The names are no longer declared in `apps/server/.env.schema`; `varlock` still hands an undeclared name from an `.env` file to the server, which is all the import needs.

## Which settings are live today

A setting is **live** when its reader asks the settings service on every use. All twenty-three settings are live (phases 3 to 5 of the move): no reader uses an environment variable any more.

| Setting                                               | Replaces                                                                         | What reads it, and when                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `claudeLiveInput`                                     | `ZETTA_CLAUDE_LIVE_INPUT`                                                        | `chat/harness.ts`, at the start of every Claude Code run                                                                                    |
| `lightRuns`                                           | `ZETTA_LIGHT_RUNS`                                                               | `chat/harness.ts`, at the start of every run that asks to be light (the daily reading of chats)                                             |
| `memoryLearn`                                         | `ZETTA_MEMORY_LEARN`, `ZETTA_WIKI_LEARN`                                         | `memory/jobs.ts`, on every tick that queues finished work                                                                                   |
| `lessonBatch`                                         | `ZETTA_LESSON_BATCH`                                                             | `learning/batch.ts`, on every tick (a person's own Lessons switch stays below it)                                                           |
| `embedding`                                           | `ZETTA_EMBEDDING`                                                                | `knowledge/embed.ts`, on every embedding call                                                                                               |
| `hostSkills`                                          | `ZETTA_HOST_SKILLS`                                                              | `bot-claude/host-skills.ts`, whenever skills are listed or loaded                                                                           |
| `mcpMemberStdio`                                      | `ZETTA_MCP_MEMBER_STDIO`                                                         | `integrations/mcp.ts`, whenever a local command is added or used                                                                            |
| `mcpAllowlist`                                        | `ZETTA_MCP_ALLOWLIST`                                                            | `integrations/mcp.ts`, whenever a local command is added (it used to be read once at start)                                                 |
| `harnessMax`, `harnessMaxPerUser`, `harnessWaitMs`    | `ZETTA_HARNESS_MAX`, `ZETTA_HARNESS_MAX_PER_USER`, `ZETTA_HARNESS_WAIT_MS`       | `chat/harness.ts`, at every request for a place to run (it used to be read once at start): see below                                        |
| `roomConcurrency`                                     | `ZETTA_ROOM_CONCURRENCY`                                                         | `discussions/worker.ts`, before each claim of a room turn                                                                                   |
| `artifactsQuota`                                      | `ZETTA_ARTIFACTS_QUOTA`                                                          | `artifacts/store.ts`, on every publish and every usage read                                                                                 |
| `vmMaxPerUser`, `vmMaxRunningPerUser`, `vmMaxRunning` | `ZETTA_VM_MAX_PER_USER`, `ZETTA_VM_MAX_RUNNING_PER_USER`, `ZETTA_VM_MAX_RUNNING` | `computer/vm.ts`, on every create and every start of a computer (they used to be read once at start)                                        |
| `vmDrivers`, `vmOs`                                   | `ZETTA_VM_DRIVERS`, `ZETTA_VM_OS`                                                | `computer/vm.ts`, on every create, start and driver change, and `GET /api/computer/capabilities` (the list the Studio computers page shows) |
| `allowPrivateNetwork`                                 | `ZETTA_ALLOW_PRIVATE_NETWORK`                                                    | Every outbound check of a private, loopback or link-local address: see below                                                                |
| `hostRunner`                                          | none                                                                             | the playground and Apps host runner, at every call: see below                                                                               |
| `serverLogin`                                         | none                                                                             | `engine-accounts/service.ts` (`forRun`), at every run: see below                                                                            |
| `codeAccess`                                          | `ZETTA_CODE_ACCESS`                                                              | `chat/pipeline.ts` (`codeEnabled`) and the playground and Apps host runner, at every call: see below                                        |
| `wahaUrl`                                             | `ZETTA_WAHA_URL`                                                                 | `integrations/plugins/whatsapp.ts`, at every WhatsApp call that uses the shared server                                                      |

### Security policy: private networks and code access

**`allowPrivateNetwork`** (sensitive, installation only, off by default) decides whether the server may call addresses on this computer or the network around it. `services.ts` builds one policy object from the settings service (`modules/settings/private-network.ts`) and hands it to every module that checks an address: computers (browser navigation and remote computers), machines (ssh, sftp, ftp), MCP servers, the speech-to-text and text-to-speech providers, the update feed, mail servers, WhatsApp (a server a person typed), Home Assistant, the vault adapters (1Password Connect, Bitwarden, OpenBao) and the address fields of the installation settings. Each asks **at the moment of the check**, so turning the setting on or off applies to the next request with no restart (other instances within 5 seconds). **It fails closed:** when the setting cannot be read (a database error) the answer is "not allowed". With the value unchanged, behaviour is as before. Tests inject `allowPrivate: true` as before.

**`codeAccess`** (sensitive, `narrow`) turns code off for every bot at once when it is `off`. Code is also off when Zetta is open to the network and `ZETTA_HARNESS_RUNTIME` is not `docker` (the CLI would run as the server's own OS user), **unless an administrator explicitly saves `codeAccess` as On** in Studio > Server settings: that is how to accept the risk. The registry default does not count as a choice, so an install that never decided stays safe. Both are decided at every call; **nothing writes the process environment any more** (the boot code used to set `ZETTA_CODE_ACCESS=off`). The old way to accept the risk, `ZETTA_CODE_ACCESS=host`, still works once: the boot import saves it as On. Otherwise run bots in Docker. A person's own bot setting (`codeAccess` on the bot) still has to be on, and the playground and Apps host runner follow the same answer and then `hostRunner`.

**`serverLogin`** (sensitive, installation only, `allowed` / `off`, never imported from a variable) decides what happens to a person who connected no account to an engine. `allowed` (the default) runs them on the sign-in of the server's own user, as before accounts existed; `off` refuses the run as not signed in, which a bot's fallback engine can take over. It is read by `modules/engine-accounts/service.ts` (`forRun`) at every run. See [agent-accounts.md](agent-accounts.md).

**`hostRunner`** (sensitive, installation only, `auto` / `on` / `off`, never imported from a variable) decides whether a playground or an app may run on the server itself, as the server's own OS user and in no container. Code access must allow it first. `auto` (the default) allows it on a local install and refuses it once Zetta is open to the network, **with `ZETTA_HARNESS_RUNTIME=docker` too**: bots are confined to containers there, this runner is not. `on`, saved by an administrator, accepts that for every member and their bots; `off` refuses it everywhere. With bots in Docker, a bot's own run on the server still waits for an Approve card. Where it is refused, new playgrounds use the container runner when the server has one, else the browser runner, and a published app that runs on the server answers that it is turned off.

The two checks that cannot wait for the database (`codeEnabled` is used in many synchronous places, such as building a tool list) use `SettingsService.peek`: the answer from the rows this process last read, refreshed in the background every 5 seconds. It answers "unknown" when the rows were never read, or the database has not answered for 20 seconds, and the callers treat "unknown" as off. The service reads the rows once at start (`warm`). Everything else asks `get` and waits.

### The WhatsApp server

The shared WAHA server (`whatsapp-waha.md`) has an address, the setting `wahaUrl` (empty means the built-in `http://127.0.0.1:3010`, imported once from `ZETTA_WAHA_URL`), and a key, a sealed connection saved in Studio > Plugins > WhatsApp > Server for everyone and recorded in `installation_settings.waha_connection_id`. The key is **never** imported from `ZETTA_WAHA_API_KEY`: the server logs a warning while that variable is set and does not read it. A person's own server settings in the plugin always win, and the shared key is never sent to them.

### Limits that hold state

The bot-run limiter, the room worker and the computer manager keep state (running counts, a queue of waiters, running computers), but not the limit: it is read from the setting at the moment of each decision.

- **Bot runs** (`harnessMax`, `harnessMaxPerUser`, `harnessWaitMs`): every request for a place reads the three values first. A lowered limit holds new runs at once and never stops a run that is going. A raised limit starts the runs that wait: when the next run ends, when the next request arrives, or at the latest one second later (a waiting run looks at the setting every second; the setting itself is cached for 5 seconds, so another instance sees a change within that time). `harnessWaitMs` counts for runs that start waiting after the change; a run that already waits keeps the wait it began with.
- **Room turns** (`roomConcurrency`): read before each claim. A lowered limit stops claiming; running turns finish. A raised one is used by the next pump (the 30-second tick or the next room event).
- **Artifacts** (`artifactsQuota`): a publish over the limit is refused, and nothing is deleted when the limit is lowered below what a person keeps.
- **Computers** (`vmMaxPerUser`, `vmMaxRunningPerUser`, `vmMaxRunning`): a lowered limit refuses the next create or start; computers that run keep running. `0` means none may be created or started. There is no queue: a refused start is a `LIMIT` error to try again.
- **Drivers and systems** (`vmDrivers`, `vmOs`): a computer keeps the driver it was given; if the driver is no longer offered it does not start under another one. An organization may narrow a list to nothing (the installation value cannot be empty). The code then offers no driver or system: `GET /api/computer/capabilities` lists none, creating a computer and starting one are refused with `UNSUPPORTED` and the text "No driver is offered for computers right now." (or "No system ...").

The code no longer reads these variables, and `apps/server/.env.schema` no longer declares them. A value left in a `.env` file or in the process environment still reaches the one-time import below (`varlock run` passes a name that the schema does not declare, and `varlock codegen` only warns that the name is not declared); after the first start, change the value in Studio and remove the variable. `ZETTA_WIKI_LEARN`, the old name of `ZETTA_MEMORY_LEARN`, is understood by the import only.

## How fast a change is seen

Readers ask for the value on each use, so a change needs no restart. Each process keeps the rows it read in memory for **5 seconds**, so a busy request path does not query the database every time. A change made through a process is seen by that process at once; the **other instances see it within 5 seconds**. Nothing is pushed between instances.

## In Studio

Administrators see **Studio > Server settings** (`/studio/settings`; members do not see the tab and no request is made). It is a page, generated from `GET /api/settings`:

- The keys are grouped by the registry's `group`. Each shows its name, help, the control for its type (a switch for `on | off`, a number field with its range, a list editor or ticks for a list with options, a choice) and the value that counts now with its source in words: _Set for the installation_, _Set for this organization_, _Imported from the environment when the server was upgraded_, or _The default_.
- **Save** works one key at a time, and the server's plain error is shown next to the field. **Reset to default** appears where a value is stored (it removes the stored value).
- A **sensitive** key is marked "Security policy: changes apply at once to everyone" and asks for a confirmation before it is saved.
- The filters live in the address: `?group=` (a group), `?show=changed` (only keys whose source is not the default) and `?q=` (a word in the name, help or key). A filter at its default is left out.
- Today only the installation scope exists, so nothing about organizations is shown but one sentence in the header. A column or switcher for an organization appears when the API reports a workspace scope.

Zetta (the Chief) can do the same in a chat for an administrator: `zetta:setting` list and get answer at once; set and reset are approval cards, never remembered as "always allow". It refuses a sensitive key and tells the person to use Studio. There is no MCP tool for settings (see `docs/decisions/bot-parity.md`).

## API

All routes are for administrators and need no sealed transport key, so any `api` instance serves them (they are not in `worker-only.ts`):

- `GET /api/settings`: every key with its metadata, the value that counts, its source (`organization`, `installation`, `imported`, `default`) and the sensitive flag. `?organizationId=` adds an organization's view.
- `PUT /api/settings/:key` with `{ "value": ..., "organizationId"?: ... }`.
- `DELETE /api/settings/:key`: goes back to the default (or, with `?organizationId=`, to the installation value).
