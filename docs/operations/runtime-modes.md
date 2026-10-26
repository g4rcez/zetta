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

## Desktop computers ("VMs")

`ZETTA_DESKTOP_RUNTIME=docker` gives every user a persistent Linux computer, and bots can ask for more. Build the image once:

```
docker build -t zetta-desktop:latest docker/desktop
```

Each VM is one container: Debian, TigerVNC's X server, XFCE (panel, menu, terminal, file manager), Chromium and [cua-spacesd](https://github.com/trycua/cua/tree/main/libs/cua-spacesd).

- **Persistence.** The `zetta-vm-<id>` container and the volume of the same name, mounted at `/home/agent`, persist. Chromium sign-ins survive the 15-minute idle stop. Deleting a VM in Studio > Computer destroys both.
- **Control channel.**
  - The server drives the desktop through spacesd's MCP endpoint, published on `127.0.0.1` only.
  - Each start uses a fresh bearer token, written to a 0644 file inside a 0700 directory under `ZETTA_VM_TOKEN_ROOT` (default `.zetta-vm/`) and mounted read-only.
  - The browser never sees the token.
- **Screen (VNC).**
  - TigerVNC serves the X display on port 5900, also published on `127.0.0.1` only, with a fresh 8-character password per start (the `vncpass` file next to the token).
  - The web app (noVNC) asks for a one-time, 30-second ticket (`POST /api/computer/vms/:id/vnc-ticket`) and opens the WebSocket `/api/computer/vms/:id/vnc?ticket=…`; the Origin must be a trusted one.
  - The server answers the VNC password challenge itself and offers the browser "no authentication", so the password never reaches it. People and bots share one screen, mouse and keyboard.
  - A connected viewer keeps its VM from the idle stop. The console (a dialog from Studio > Computer or a bot's chat card, or its own window at `/computer/<id>`) has Take over / Hand back, "Paste text on the computer" and a keyboard layout picker.
  - Paste types the text into the focused window with `xdotool` (`POST /api/computer/vms/:id/paste`); the layout is set with `setxkbmap` from an allowlist (`POST /api/computer/vms/:id/keyboard`). Both run through the container CLI's `exec`, never a shell.
- **Installing software.** There is no root in a VM (no capabilities, no-new-privileges). Install per user under the home volume, which survives stops and image updates. For example, Google Chrome:
  `wget https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb` (or `_amd64`), then `dpkg-deb -x google-chrome-*.deb ~/.local/opt/google-chrome` and `~/.local/opt/google-chrome/opt/google/chrome/google-chrome --no-sandbox`.
- **Memory.** Plan about 1 GB per running VM on top of other containers. Podman's default 2 GB machine fits one VM at most: raise it with `podman machine set --memory 6144` (machine stopped).
- **Who gets which VM.**
  - Every user has a default VM, created on first use.
  - A bot can propose an extra one (`zetta:create_vm`), and it exists only after the user approves it.
  - When a bot starts using a computer, the chat shows a live card. The user can watch it and click or type along, or take over (bots pause) and hand back.
- **Limits.** Defaults: 4 VMs per user, 2 running per user, 6 running in total, 2 GB and 2 CPUs each. Override them with `ZETTA_VM_MAX_PER_USER`, `ZETTA_VM_MAX_RUNNING_PER_USER`, `ZETTA_VM_MAX_RUNNING`, `ZETTA_VM_MEMORY`, `ZETTA_VM_CPUS` and `ZETTA_VM_IMAGE`.
- **Isolation.**
  - Containers drop every capability.
  - `ZETTA_VM_RUNTIME=runsc` runs them under gVisor.
  - Chromium runs with `--no-sandbox` because the container is the boundary.
  - Navigation the bot asks for is checked against the public-address policy, but pages can still reach any address. To block private ranges and cloud metadata, attach VMs to a dedicated network (`ZETTA_VM_NETWORK`) and add host firewall rules for it.
- **Podman.** Set `ZETTA_DOCKER_BIN` to the podman binary and `ZETTA_VM_IMAGE=localhost/zetta-desktop:latest`.
- **Tests.** The real-container suite is `ZETTA_VM_TEST=1 bun test src/modules/computer/vm-docker.test.ts`.
