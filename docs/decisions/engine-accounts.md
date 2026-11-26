# Agent accounts per person

Date: 2026-11-26.

## Context

One server had one sign-in per agent CLI: the server user's own. Every person's bot ran on that subscription. A per-person folder existed (`harnessHome`, `chat/harness.ts`) but only when the host set `ZETTA_HARNESS_HOME_ROOT`, nobody could sign in to it from the web app, and whether an engine was signed in was guessed from past runs. Sealed API keys existed only as bot requirements (`bot_connection`).

## Decisions

1. **An account belongs to a person and an engine** (`engine_account`). It is a sealed token, a sealed key, or the CLI's own sign-in in a folder of that account. One per person and engine is the default.
2. **Engine, model and account are each person's own choice per bot** (`bot_engine`). The owner's choice is the bot's own columns and the default for everyone else.
3. **Who pays** is the asker, except a shared Chief (its owner, everywhere) and a bot set to `owner_in_rooms` (its owner, in rooms). `payerOf` in `modules/engine-accounts/service.ts` is the one place that says so.
4. **Sign-in is guided in the browser, with pasting as the second way.** The server runs only the CLI's dedicated sign-in command, never a shell, and reads the link and the code from its output.
5. **The server's own sign-in stays as a fallback** behind the setting `serverLogin` (`allowed` by default, so existing servers keep working; `off` forces accounts).

## How a run gets its account

The runner asks before it starts any CLI: `setRunAccounts` in `chat/harness.ts`, registered once at start-up with `engineAccounts.forRun`. Every caller goes through it, the turn pipeline and the single-shot helpers alike, so no path can start a CLI on the wrong sign-in. The answer is the account's variables, `undefined` for the server's own sign-in, or `HarnessError("auth_required")`, which the existing fallback-engine logic already handles.

The turn pipeline (`TurnEngines` in `chat/pipeline.ts`) applies the person's engine and model for the bot and passes on who pays. The chat service marks room turns and records the engine, the account and the payer in `audit_event`.

## What each engine needs (checked on 2026-11-26: claude 2.1.332, codex 0.163.0, pi 1.4.0, omp 18.6.1)

| Engine      | Guided sign-in                                                         | A run uses it through                                  |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Claude Code | `claude setup-token` in a terminal the server gives it; yields a token | `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`)     |
| Codex       | `codex login --device-auth`: a link and a one-time code, nothing typed | `CODEX_HOME` pointing at the account's folder          |
| OMP         | `omp login <provider>` with its input kept open; takes a pasted code   | `PI_CODING_AGENT_DIR` pointing at the account's folder |
| Pi          | none: it signs in only inside its own screen                           | the provider's key variable, `PI_CODING_AGENT_DIR`     |

`claude setup-token` prints nothing without a terminal; `claude auth login` does, but it leaves a sign-in in a folder and, on macOS, in the keychain. The token is the form that travels to a run without sharing any folder, so it is the one used. A CLI that keeps a sign-in in a folder is always pointed at the account's own folder, also for a key: left at the server user's folder it would find that user's sign-in and could run on it.

## When a sign-in ends

A run refused with a sign-in error reports its account (`setAccountRefused` in `chat/harness.ts`). The error alone proves little, because the same words appear in other failures, so only a sign-in kept in the account's folder (Codex, OMP) is asked again with the CLI's own status command, which decides. A token or a key is left as it is. A person whose accounts for an engine are all signed out gets `auth_required`, never the server's own sign-in: having connected an account, they would not expect to spend someone else's subscription. **Try again** (`POST /api/engine-accounts/:id/check`) asks the CLI again, or puts a token or a key back to work so that the next run checks it.

## Consequences

- **The run's home folder is unchanged.** An account changes the credential, and for Codex, Pi and OMP the CLI's own folder. Whether runs get a home of their own per person stays the host's choice (`ZETTA_HARNESS_HOME_ROOT`), because Claude Code loads host skills from the shared home.
- A Codex sign-in used for someone else's message (a shared Chief, a room bot) keeps that run's session file in the account's folder on the server. A token or a key leaves nothing there.
- A sign-in lives in the memory of the process that started it, and its state is polled. A restart forgets it.
- `serverLogin` is security policy and one value for the server: root's to change.
