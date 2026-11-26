# A server of your own: Arch Linux on a VPS

`packages/infra` sets up Zetta on an Arch Linux server and keeps it updated over SSH. Zetta runs natively under systemd, with its own Postgres and Caddy for HTTPS. It is sized for a small machine (1 vCPU, 4 GB of RAM).

```
Internet ─► Caddy :80/:443 ─► 127.0.0.1:3000  zetta.service (Bun)
                                                ├─ the web app and /api
                                                └─ Postgres over its Unix socket (no TCP port)
```

For an install with containers on one computer, use the [installer](../../README.md#install) instead.

## What you need

- A server with Arch Linux (x86_64 or aarch64), root access over SSH (password or key), 4 GB of RAM and 15 GB of free disk.
- A domain whose A record (and AAAA, if the server has IPv6) points at the server.
- Ports 80 and 443 open in your provider's firewall, if it has one.
- On your computer: this repository, [Bun](https://bun.sh), `git`, `ssh`, `rsync`, `tar` and an SSH key pair (`ssh-keygen -t ed25519`).

## First time

1. Write `packages/infra/.env.production`. Git ignores it.

   ```
   DEPLOY_HOST=203.0.113.7
   DEPLOY_DOMAIN=zetta.example.com
   # DEPLOY_SSH_KEY=~/.ssh/zetta          (default: what ssh would use, with ~/.ssh/id_ed25519.pub installed)
   # DEPLOY_SSH_USER=deploy               (your admin user on the server)
   # DEPLOY_SSH_PORT=22
   # DEPLOY_ACME_EMAIL=you@example.com    (certificate notices)
   ```

2. Prepare the server. The first run logs in as root, creates your admin user, and closes root and password login after it has proven that the new login works. Keep your provider's web console as a way back in.

   ```
   bun run infra bootstrap
   ```

   If it says the kernel was upgraded, restart the server (`bun run infra ssh`, then `sudo reboot`) and run it again. It is safe to run any number of times: a second run changes nothing.

3. Store the connection key in your password manager. It is generated on the server, and without it a restored database cannot open the saved connections.

   ```
   bun run infra secrets backup
   ```

4. Deploy, then sign the agent CLI in:

   ```
   bun run infra deploy
   bun run infra login claude
   ```

5. Open `https://<your domain>` right away. Paste the setup key (`bun run infra secrets setup-key`). At **Who can reach Zetta?** choose **Open to my network** with `https://<your domain>` as the public address, create your account, and then restart:

   ```
   bun run infra restart
   ```

   The setting matters on a public server. Left on **Only this computer**, Zetta trusts the machine it runs on, which is wrong behind a public address.

## Settings for 4 GB

Set these once, in the web app:

| Where                    | Setting                      | Value |
| ------------------------ | ---------------------------- | ----- |
| Studio > Decisions       | Decision model (Laya), ~2 GB | Off   |
| Studio > Server settings | Bot runs at once, in total   | 2     |
| Studio > Server settings | Bot runs at once, per person | 2     |
| Studio > Server settings | Room turns at once           | 1     |

Desktop computers and bot browsers in containers do not fit on a machine of this size.

## Bots that run code

Once Zetta is open to the network, code access is off (see [runtime modes](runtime-modes.md)). There are two ways to have it:

- **`sandbox: "host"`** (the default). Turn on **Bots may run code** in Studio > Server settings. A bot's commands then run as the `zetta` user, which owns Zetta's files and database: do this only when you trust everyone who can talk to your bots.
- **`sandbox: "podman"`** in `packages/infra/environments/production.ts`, then `bootstrap`. Each run happens in a rootless container built from `docker/harness`, which holds Claude Code. Every person signs in apart:

  ```
  bun run infra login claude --account <user id>
  ```

  The ids: `bun run infra ssh`, then `sudo -u zetta psql -d zetta -c 'select id, email from "user"'`.

## What is on the server

| What       | Where                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Code       | `/srv/zetta/releases/<time>-<commit>`; `/srv/zetta/current` points at the running one                            |
| Data       | `/var/lib/zetta` (files, agent sign-ins, model downloads) and the database `zetta`                               |
| Settings   | `/etc/zetta/zetta.env`, written by `bootstrap`                                                                   |
| Secrets    | `/etc/zetta/secrets.env`, generated once, readable by root only                                                  |
| Services   | `zetta`, `postgresql`, `caddy`, `sshguard`, `zetta-backup.timer`; the firewall rules are in `/etc/nftables.conf` |
| Open ports | SSH, 80 and 443. Zetta listens on `127.0.0.1` and Postgres on its socket only                                    |
| Users      | your admin user (sudo without a password, so guard its key) and `zetta`, which runs the server and cannot log in |

## Day to day

| Command                                | Does                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `bun run infra deploy`                 | Release the current commit (`--ref <git ref>` for another) |
| `bun run infra status`                 | Services, health, memory, disk, releases, backups          |
| `bun run infra logs -f` (`--all`)      | Follow the log (with Caddy and Postgres)                   |
| `bun run infra rollback` (`--to <id>`) | Run an earlier release                                     |
| `bun run infra restart`                | Restart and wait until it answers                          |
| `bun run infra migrate`                | Apply waiting migrations of the running release            |
| `bun run infra backup` / `backup pull` | Back up now / download the newest backup                   |
| `bun run infra login <agent>`          | Sign an agent CLI in again                                 |
| `bun run infra ssh`                    | A shell on the server                                      |

`--dry-run` prints what any command would send, without connecting.

## What a deploy does

1. Builds the server and the web app **on your computer**, from the commit only. Uncommitted work and local `.env` files never ship, and the landing page is not deployed.
2. Uploads the release and installs the server's dependencies there.
3. When migrations are waiting: stops Zetta, takes a backup, applies them, and starts Zetta again. The database role is a superuser only while the migrator runs. A migration that fails is rolled back, and the earlier release keeps running.
4. Switches to the new release and waits for it to answer. If it does not, the earlier release comes back and the new one is set aside.
5. Keeps the newest five releases.

A rollback changes the code only: migrations are not undone.

## Backups and restore

A backup is a folder with the database (`database.dump`) and the files (`files.tar.gz`, without model downloads). One is taken every night at 04:00 UTC and one before every migration. The server keeps seven of each kind under `/var/backups/zetta`. They are on the same disk as Zetta, so download one regularly:

```
bun run infra backup pull          # into ~/zetta-backups/production
```

To restore, on the server:

```
sudo zetta-restore /var/backups/zetta/scheduled/<time>
```

It backs up the current state first, replaces the database and writes the files back over the current ones.

**On a new server:** run `bootstrap` and `deploy`, replace `ZETTA_CONNECTION_KEY` in `/etc/zetta/secrets.env` with the stored one, copy the backup folder to the server, and run `zetta-restore` on it.

## Updating the system

`sudo pacman -Syu` as usual, and restart after a kernel upgrade. A pacman hook stops an upgrade that would move Postgres to a new major version, because the new server cannot open the old data folder. To update everything else meanwhile:

```
sudo pacman -Syu --ignore postgresql,postgresql-libs,pgvector
```

### A Postgres major upgrade

1. On your computer: stop Zetta, back up and download the backup.

   ```
   bun run infra ssh          # then: sudo systemctl stop zetta
   bun run infra backup
   bun run infra backup pull
   ```

2. On the server, upgrade with the hook set aside, and keep the old data folder:

   ```
   sudo systemctl stop postgresql
   sudo mv /etc/pacman.d/hooks/00-zetta-postgres-major.hook /root/
   sudo pacman -Syu
   sudo mv /var/lib/postgres/data /var/lib/postgres/data-old
   ```

3. `bun run infra bootstrap` creates a new database cluster and puts the hook back. Then restore the backup of step 1 with `sudo zetta-restore <folder>`.
4. When Zetta works, remove `/var/lib/postgres/data-old`.

## Another environment

Add `packages/infra/environments/<name>.ts` (copy `production.ts`) and `packages/infra/.env.<name>`, then pass `--env <name>` to any command. Each environment is its own server.

## When something is wrong

- **No certificate, or the site does not answer:** check that the domain points at the server and that ports 80 and 443 are open, then `bun run infra logs --all`.
- **SSH refuses you after several tries:** `sshguard` blocks an address for a while after repeated failures. Wait, or use the provider's web console.
- **A deploy failed:** the output ends with the server's log. The earlier release is still running; `bun run infra status` shows it.
