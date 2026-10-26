# Runtime modes: with or without Docker, on Linux, macOS and Windows

Zetta runs the same product on all three operating systems and with or without Docker. Docker is an *extra* isolation layer, never a requirement.

| | Host mode (default) | Docker mode (`ZETTA_HARNESS_RUNTIME=docker`, `ZETTA_BROWSER_RUNTIME=docker`) |
| --- | --- | --- |
| Product isolation (users, bots, memory, connections, files, snapshots) | Enforced in the server and database; proven by the cross-user matrix | Same |
| Harness login | The server OS user's own CLI logins (set `ZETTA_HARNESS_HOME_ROOT` for per-user homes, which then need their own logins) | Per-user home mounted into a throwaway container |
| OS isolation of CLI runs | None beyond a throwaway empty working directory, minimal environment, own process tree, deadline, output cap, concurrency limits | Non-root, read-only root, no capabilities, resource limits, no host mounts except the user's home |
| Browser | Playwright Chromium on the host with a per-user profile | Chromium in a container with a per-user profile volume |
| Shared bots using someone else's key | Refused (the key would run under another user's instructions on the host) | Allowed |
| Best for | A single person or a trusted team on one machine | Teams that do not fully trust each other's bots |

Platform notes: process trees are killed with a process group on POSIX and `taskkill /T` on Windows; Windows additionally passes `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `SystemRoot`. Harness CLIs must exist on the server's `PATH` (Windows `.cmd` shims work through `Bun.which`). The Linux-only journal-store fixtures are skipped elsewhere. Desktop control through Cua Spaces is optional and follows Cua's own platform support. CI (`.github/workflows/ci.yml`) runs the unit suites on all three systems and the database-backed suites on Linux.
