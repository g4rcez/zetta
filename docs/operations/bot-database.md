# Bot database

Every bot gets its own private PostgreSQL schema. Bots use it to keep anything they need between conversations: task lists, preferences, options for their job, notes. The **Bot database** plugin (`postgres`) is built in, so there is nothing to install. Each bot designs its own tables. People never write SQL. They see what the bot saved in the bot's **settings > Database**, in the bot's own words.

## Names

Each bot has a **bot id** (`slug`). It is a friendly-url id, unique across the installation, chosen once when the bot is created. Renaming the bot does not change it.

- The schema and its Postgres role are both named `<slug in snake_case>_bot`. For example, `Choquei` becomes `choquei` and then `choquei_bot`.
- The slug is built from the name:
  - accents are folded (`Ação` becomes `acao`);
  - camelCase is split (`ChoqueiNews` becomes `choquei-news`);
  - other characters become `-`;
  - a trailing "bot" is dropped (`Choquei Bot` becomes `choquei`, not `choquei_bot_bot`);
  - the length limit is 40.
- Names starting with a digit, and names starting with `pg`, get a `bot-` prefix.
- A name with nothing usable left (only emoji, for example) becomes `bot`.
- When the slug is already taken, a number is appended: `choquei`, then `choquei-2`, and so on.
- A user's chief bot is named after its owner, for example `allan-garcez-chief`.

## Isolation

Postgres itself enforces isolation. Zetta does not check SQL text.

- **One login role per bot.** Each bot has its own `LOGIN` role with no superuser, createdb, createrole, replication or bypassrls rights. The role belongs to no other role, so `SET ROLE` goes nowhere.
- **The bot's schema.** The app's role owns the schema, so the bot can fill it but cannot drop it or grant it to anyone else. The bot gets `USAGE, CREATE` on it, and nothing on any other schema.
- **No `PUBLIC` rights.** The `bot-database` migration removes them on the `public` schema, on its functions, and on `CREATE`/`TEMP` on the database. App tables, `drizzle.*` and other bots' schemas all fail with `permission denied`. The proof is in `apps/server/src/modules/bot-database/isolation.integration.test.ts`.
- **Every bot statement runs as the bot.** It runs on a connection logged in as that role, inside a transaction. Reads (`db_query`) are `READ ONLY` and limited to one statement.
- **Passwords are never stored.** Each password is derived from `ZETTA_BOT_DATABASE_KEY`, or `ZETTA_CONNECTION_KEY` when that is not set. It is sent to Postgres as a SCRAM verifier, so statement logs never see it.
  - If a bot changes its own password or session defaults, the next connection re-provisions the role.
  - Rotating the key works the same way.
- **Timeouts.** The role has `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` set. The app also cancels any call that runs past 8 s from its own connection, because a bot can lift its own timeout.
- **Quota.** Writes stop when the schema reaches `ZETTA_BOT_DATABASE_QUOTA_MB` (default 50).
- **Known limit.** In a shared database, any role can read `pg_catalog`. A bot can therefore see the _names_ of other schemas and tables, but never their rows.
- **Shared bots.** A bot's database belongs to the bot's owner. When a teammate talks to a bot someone else shared with the team, the bot has no database for that conversation, so entries of one person never reach another.

## Setup

1. The app's database user needs `CREATEROLE`, or must be a superuser as in the compose Postgres. Without it the server logs `Bot databases disabled: ...`, and bots and the Database tab explain that the feature is not set up.
2. Set `ZETTA_CONNECTION_KEY`, or a separate `ZETTA_BOT_DATABASE_KEY`.
3. Apply the migrations (`bun run zetta`, or `drizzle-kit migrate` in `packages/db`).

A bot's role and schema are created when the bot is created. Older bots get theirs the first time the database is used.

## What bots can do

| Tool                | Effect | Notes                                                                                          |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `db_overview`       | read   | Tables with their descriptions and columns, row counts, and space used.                        |
| `db_query`          | read   | One `SELECT` with `$1` parameters. At most 200 rows. Allowed when answering outside people.    |
| `db_execute`        | write  | DDL and DML. Several statements are allowed when no parameters are used. Refused at the quota. |
| `db_apply_template` | write  | Ready-made `tasks`, `preferences` or `notes` tables.                                           |

Bots are told to `COMMENT ON` every table, in the form `Short title: one sentence`, and every column, in the user's language. That text is what people see.

## For people (bot settings > Database)

The Database tab offers:

- **Viewing.** It shows space used, an on/off switch for the bot, and each saved table with its description and number of entries. Click a table to browse it.
- **Ready-made tables.** Tasks, Preferences and Notes can be added with one click.
- **Download.** Download everything as JSON, or one table as CSV.
- **Start over.** This erases everything after you type the bot id to confirm. The role, bot id and switch stay.

Only the bot's owner sees this tab. Archiving a bot keeps its database.
