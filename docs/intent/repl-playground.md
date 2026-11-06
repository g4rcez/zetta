# REPL / Playground

Status: confirmed intent (product interview, 2026-11-05). This is the first part of **Zetta Apps**. The design and phases are in [playground](../decisions/playground.md).

## Intent

- **Outcome:** bots and humans write and run code in a saved playground: several files, declared typed inputs, a run history. A human opens `/playground/:id`. A bot creates and runs a playground with a typed tool and posts the link in chat.
- **Why a bot needs it:** a bot can already run any script with Bash. A playground gives a saved and shareable result, a rendered output (reports), and reproducibility: another run with the same files and inputs gives the same behaviour, and a bot or a human can inspect the result.
- **Runner, per playground:**
  - `host` (default): the CLI runs on the server host.
  - `container`: Docker or Podman, one long-lived container per language, network on.
  - `browser`: a sandboxed iframe, for HTML, JavaScript and TypeScript.
- **Languages:** TypeScript and JavaScript (`bun`), Python (`python3`), shell (`bash`), HTML (browser only). A new language is one entry in a map of language to CLI.
- **Access:** the owner is the creator, or the human a bot acts for. A playground is `private` by default. `team` lets every member read, run and fork it. Only the owner edits. Any active member may use the host runner, as members can already make bots that run Bash.
- **Output:** stdout and stderr as text. Files that a script writes to `out/` are saved with the run. An `.html` file renders in a sandboxed iframe, images show inline, other files show as text or a download.
- **Success:** a bot writes a Python report script, runs it, and posts a link. A human opens it, changes an input, runs it again, and sees both runs in the history with the files each run used.
- **Constraint:** the host runner is not a sandbox. It runs as the server user, like bot Bash. A hosted multi-tenant mode needs a stronger runner later.
- **Out of scope:** promote a playground to an app, a playground as a bot tool, schedules and triggers, a per-run sandbox for the hosted mode, live output streaming, an `/api/mcp` mirror, sharing with one specific team.
