# Updating Zetta

Zetta has no release numbers. A version is the commit the server was built from, and the day of that commit. Studio > Overview and the foot of Preferences show it as `Version 54121d6 · 2026-11-10`, so a bug report can name its build.

## How to update

Run the installer again, on the computer where Zetta is installed:

```bash
curl -fsSL https://zettabot.app/install | bash
```

It pulls the new code, keeps your `.env` files (their secrets protect what is already stored), rebuilds the images, restarts the containers and waits until Zetta answers. Your data stays on two volumes and is not touched: `zetta_postgres_data` (the database) and `zetta_data` (the files bots and people store, the bots' code folders, model downloads and the agent sign-ins). Zetta is unavailable for a minute while it rebuilds.

**The first update that adds `zetta_data`.** Older installs kept those files inside the server container, so every rebuild erased them. When the installer finds a running server and no `zetta_data` yet, it copies the files out of that container first, and back in once the new server answers. The copy stays in `.zetta-old-files` in the install folder; delete it when you have checked that everything is there.

**Changing the address or the port.** Run the installer with `--url` or `--port` after `bash -s --`:

```bash
curl -fsSL https://zettabot.app/install | bash -s -- --url https://zetta.example.com
```

It writes the new address into `apps/server/.env`, `apps/web/.env` and the `.env` next to `docker-compose.yml`, then rebuilds. Sign-in from other computers and plugins that use OAuth need an `https://` address.

**Agent CLIs.** The server image holds none by default: each is a native binary of 300 to 430 MB, and the server does not use a copy you already have on the computer. The installer reports what it finds. `--agents claude-code` (or `codex`, or `"claude-code codex"`, or `none`) chooses what goes into the image, and the choice is kept for the next update (`ZETTA_AGENTS` in the `.env` next to `docker-compose.yml`).

Installed in another folder? Put the folder in front: `curl -fsSL https://zettabot.app/install | ZETTA_DIR=/path/to/zetta bash`.

The installer also writes the version into the server image (`ZETTA_BUILD_COMMIT` and `ZETTA_BUILD_DATE`, build arguments of `apps/server/Dockerfile` that `docker-compose.yml` passes on). A build made by hand with `docker compose up -d --build` has no stamp, so it reads `Version unknown` and cannot say whether it is behind. A server run from a source checkout (`bun run dev`) asks git instead.

## How Zetta tells you an update exists

Once a day the server reads the list of changes the landing site publishes at `https://zettabot.app/changelog.json` and compares its newest day with the day of the build. The result is one of:

- **current**: the build is on the newest published day.
- **behind**: newer changes exist. The administrator sees a quiet **Update available** link at the foot of the sidebar and one **Catch up** card. Both open **Update**, which lists the changes since the build (the newest 30) and the command above with a copy button.
- **unknown**: the build has no stamp, the list could not be read, or the check is off.

Members who are not administrators see nothing. The card is raised for the administrator only, at most one at a time. It closes by itself when the build is current. A card you dismiss does not come back for the same version.

The day is the unit: the list groups changes by UTC day, so a build made earlier on the newest day counts as current.

## What the check sends

One plain `GET` of that address. It has no body, no cookies, no query string and no identifier: not a name, an address, an installation id or the version of the build. The only header is `Accept: application/json`. The answer is capped at 512 KB, the request at 5 seconds, and any failure is ignored (it tries again an hour later, or tomorrow). The result is kept in memory, so a restart checks again at once. With several servers (see `scaling.md`), the worker runs the check and raises the card; an `api` server answers from its own check, at most once a day.

`GET /api/meta` stays public and carries no version. The version is read at `GET /api/installation/version`, for a signed-in person only.

## How to turn it off

- **Administrator:** Studio > Server settings > **Check for updates**, or ask the Chief to open the installation settings. Off sends nothing, hides the mark and closes the card.
- **Operator:** set `ZETTA_UPDATE_CHECK=off` in `apps/server/.env`. It wins over the setting, and Studio says so.

To read the list from another address (a mirror, for example), set `ZETTA_UPDATE_FEED` to an `https://` address with the same JSON shape. It must not be on a private network unless the setting `allowPrivateNetwork` is on (Studio > Server settings), as for every other address an administrator types.

## Not included

Release tags, signed packages and desktop auto-update. Zetta never updates itself: you run the command when you choose to.
