// The environment names the code may read. The rule: **only the host is configured through the environment**. Everything that is product
// behaviour, a limit, a quota, a model choice, the address of an outside service or a key belongs in the database (`zetta.setting`, the
// registry in ./settings.ts, or a sealed connection) and in Studio, never in `process.env`.
//
// `host-env.test.ts` scans the source and fails for a name that is not on `HOST_ENV` (`MIGRATING` is empty and must stay so). To add a variable you must
// decide, in review, that it is a fact about the machine (and add it here with its reason). A switch, a limit or a key is never that.
//
// What the scan covers: non-test, non-script source under apps/server/src, apps/web/src, apps/cli/src and packages/*/src. What it cannot
// see: dynamic names (`process.env[name]`, which `DYNAMIC_READS` lists by expression), names built from strings elsewhere, variables a child
// process reads on its own, and everything under apps/desktop (the desktop app, its installer, docker files and the demo and e2e kits set
// variables for their own processes; they are out of scope on purpose).

export type HostEnvKind = "bootstrap" | "host";
export type HostEnvEntry = { kind: HostEnvKind; reason: string };

/** Needed before the database can be reached (a URL, a key, where to listen, where the data lives). */
const bootstrap = (reason: string): HostEnvEntry => ({ kind: "bootstrap", reason });
/** A property of the machine or process that the database cannot know (a path, an engine, a timer, a platform variable). */
const host = (reason: string): HostEnvEntry => ({ kind: "host", reason });

/** Names the code may read, with why each one is the host's business. */
export const HOST_ENV: Readonly<Record<string, HostEnvEntry>> = {
  // Bootstrap: before the database is reachable.
  DATABASE_URL: bootstrap("The database address; empty means the embedded Postgres."),
  BETTER_AUTH_SECRET: bootstrap("Signs sessions; read before any stored setting."),
  BETTER_AUTH_URL: bootstrap("The sign-in system's own address, derived from the server address."),
  CORS_ORIGIN: bootstrap("The sign-in system's allowed origin, derived from the server address."),
  ZETTA_CONNECTION_KEY: bootstrap(
    "The key that seals every stored secret; it cannot live in the database it protects.",
  ),
  ZETTA_CONNECTION_KEY_ID: bootstrap("Names the connection key in use, for key rotation."),
  ZETTA_SETUP_KEY: bootstrap("Lets the first administrator be created before anyone can sign in."),
  ZETTA_DESKTOP_LINK_TOKEN: bootstrap("Pairs the desktop app that started this server with it."),
  ZETTA_SERVER_URL: bootstrap(
    "The one public address: origin of sign-in, CORS, OAuth callbacks and MCP.",
  ),
  ZETTA_OAUTH_REDIRECT_BASE: bootstrap(
    "The public base of OAuth callbacks when it differs from the server address.",
  ),
  ZETTA_HOST: bootstrap("The interface the listener binds to."),
  PORT: bootstrap("The port the listener binds to."),
  ZETTA_TLS_CERT: bootstrap("Path of the TLS certificate the listener serves."),
  ZETTA_TLS_KEY: bootstrap("Path of the TLS key the listener serves."),
  NODE_EXTRA_CA_CERTS: bootstrap("Extra certificate authorities, read by the runtime itself."),
  NODE_ENV: bootstrap("The mode the process runs in (development, production, test)."),
  ZETTA_COOKIE_SAMESITE: bootstrap(
    "Cookie policy of the sign-in session, decided by how the host exposes the server.",
  ),
  ZETTA_EXTRA_ORIGINS: bootstrap(
    "Extra origins that may sign in (a tunnel address); decided where the server is exposed.",
  ),
  ZETTA_HOME: bootstrap("The data directory every other path defaults under."),
  ZETTA_PG_ARCHIVE: bootstrap("Where the embedded Postgres runtime archive is."),
  ZETTA_MIGRATIONS_DIR: bootstrap(
    "Where the migrations are, which run before the database is usable.",
  ),
  ZETTA_WEB_DIST: bootstrap("Where the built web app is served from."),
  ZETTA_DB_POOL_MAX: bootstrap(
    "Size of the database pool, tied to the database server's own limit.",
  ),
  ZETTA_ROLE: host("Which part of the system this process runs (all, api or worker)."),
  ZETTA_EVENT_BUS: host("How instances tell each other about changes (local or through Postgres)."),
  ZETTA_INSTANCE_NAME: host("The name this process registers under."),
  ZETTA_INTERNAL_URL: host("The address a container uses to reach this server."),
  ZETTA_TRUSTED_IP_HEADER: host(
    "The proxy header that carries the client address; only the host knows its proxy.",
  ),
  ZETTA_AUTH_RATE_LIMIT_STORAGE: host(
    "Where sign-in rate limits are counted (memory or database), decided by the number of instances.",
  ),
  // Operator CLI (run by a person on the machine, outside the app).
  ZETTA_OPERATOR_DATABASE_URL: bootstrap("The operator CLI's own database address."),
  ZETTA_OPERATOR_ALLOW_MUTATION: host("The operator CLI's guard before it changes anything."),
  ZETTA_RECOVERY: host("Switches the restart recovery to its old behaviour, for the operator."),
  // Timers and tuning of the process.
  ZETTA_HEARTBEAT_MS: host("How often an instance says it is alive."),
  ZETTA_FENCE_AFTER_MS: host("How long before an instance is fenced."),
  ZETTA_INSTANCE_DEAD_AFTER_MS: host("How long before an instance counts as dead."),
  ZETTA_SSE_HEARTBEAT_MS: host("Keep-alive of the live stream, tuned to the proxy in front."),
  ZETTA_HARNESS_SLOT_MS: host("How long a run holds a start slot (tuning)."),
  ZETTA_ROOM_STUCK_MS: host("How long a room turn may go without progress (tuning)."),
  ZETTA_LAYA_PRELOAD: host("Loads the Laya model at boot or on first use (boot timing)."),
  // Build and updates.
  ZETTA_BUILD_COMMIT: host("Build metadata of this binary."),
  ZETTA_BUILD_DATE: host("Build metadata of this binary."),
  ZETTA_UPDATE_CHECK: host("The operator's veto of the daily update check (documented design)."),
  ZETTA_UPDATE_FEED: host("The operator's mirror of the changelog."),
  // Directories and files.
  ZETTA_CODE_ROOT: host("Where each person's code directory lives."),
  ZETTA_FILES_ROOT: host("Where files live."),
  ZETTA_ATTACHMENTS_ROOT: host("Where chat attachments live."),
  ZETTA_ARTIFACTS_ROOT: host("Where artifacts live."),
  ZETTA_BROWSER_ROOT: host("Where browser profiles live."),
  ZETTA_VM_TOKEN_ROOT: host("Where computer tokens live."),
  ZETTA_CLAUDE_PLUGIN_ROOT: host("Where the Claude Code plugin is."),
  ZETTA_HARNESS_HOME_ROOT: host("Where each person's CLI home folders live."),
  ZETTA_PLAYGROUND_DIR: host("Where playground runs live."),
  ZETTA_EMBEDDING_MODEL_DIR: host("Where the local embedding model is cached."),
  ZETTA_TRANSCRIBE_MODEL_DIR: host("Where the local transcription model is cached."),
  ZETTA_SPEECH_MODEL_DIR: host("Where the local speech model is cached."),
  ZETTA_AGENT_BROWSER_BIN: host("Path of the agent-browser binary."),
  ZETTA_CHROMIUM_PATH: host("Path of the Chromium binary."),
  // Container engine and the limits of its containers (a fact about this machine's CPU and memory).
  ZETTA_CONTAINER_ENGINE: host("Which container engine this machine has."),
  ZETTA_CONTAINER_USER: host("The user containers run as."),
  ZETTA_DOCKER_BIN: host("Path of the container engine's binary."),
  ZETTA_DESKTOP_RUNTIME: host("How the desktop (computer) containers run on this machine."),
  ZETTA_HARNESS_RUNTIME: host("Whether bot runs use host or container."),
  ZETTA_HARNESS_IMAGE: host("The image of a bot run's container."),
  ZETTA_HARNESS_CPUS: host("CPU limit of a bot run's container."),
  ZETTA_HARNESS_MEMORY: host("Memory limit of a bot run's container."),
  ZETTA_HARNESS_PIDS: host("Process limit of a bot run's container."),
  ZETTA_HARNESS_NETWORK: host("Network of a bot run's container."),
  ZETTA_BROWSER_RUNTIME: host("Whether browsers run on the host or in containers."),
  ZETTA_BROWSER_IMAGE: host("The image of a browser container."),
  ZETTA_BROWSER_CPUS: host("CPU limit of a browser container."),
  ZETTA_BROWSER_MEMORY: host("Memory limit of a browser container."),
  ZETTA_BROWSER_PIDS: host("Process limit of a browser container."),
  ZETTA_PLAYGROUND_CPUS: host("CPU limit of a playground container."),
  ZETTA_PLAYGROUND_MEMORY: host("Memory limit of a playground container."),
  ZETTA_PLAYGROUND_PIDS: host("Process limit of a playground container."),
  ZETTA_PLAYGROUND_NETWORK: host("Network of a playground container."),
  ZETTA_VM_IMAGE: host("The image of a computer (desktop container)."),
  ZETTA_VM_IMAGE_UBUNTU: host("The image of an Ubuntu computer."),
  ZETTA_VM_MEMORY: host("Memory limit of a computer."),
  ZETTA_VM_CPUS: host("CPU limit of a computer."),
  ZETTA_VM_PIDS: host("Process limit of a computer."),
  ZETTA_VM_SHM: host("Shared memory of a computer."),
  ZETTA_VM_RUNTIME: host("The container runtime of a computer."),
  ZETTA_VM_NETWORK: host("Network of a computer."),
  // Platform variables, read as the machine has them.
  HOME: host("The user's home folder, from the platform."),
  PATH: host("Where programs are found, from the platform."),
  APPDATA: host("Windows application data folder, from the platform."),
  LOCALAPPDATA: host("Windows local application data folder, from the platform."),
  USERPROFILE: host("Windows home folder, from the platform."),
  XDG_CACHE_HOME: host("Linux cache folder, from the platform."),
  XDG_CONFIG_HOME: host("Linux config folder, from the platform."),
  XDG_DATA_HOME: host("Linux data folder, from the platform."),
  SSL_CERT_FILE: host(
    "Trust store file, passed on to the vault CLIs (listed in a constant, so the scan cannot see the read).",
  ),
  SSL_CERT_DIR: host(
    "Trust store folder, passed on to the vault CLIs (listed in a constant, so the scan cannot see the read).",
  ),
  DOCKER_HOST: host("The address of the container engine, passed to it as it is."),
  HF_TOKEN: host("The operator's own Hugging Face token for downloading model weights."),
  LAYA_CACHE: host("Where the Laya weights are cached."),
  GITHUB_TOKEN: host(
    "Handed to the bot's process (set by the server, read by the GitHub CLI), never read as configuration.",
  ),
  // Build-time variables of the web app.
  DEV: host("Vite's development flag."),
  PROD: host("Vite's production flag."),
  VITE_HIDE_DEVTOOLS: host("Hides the developer tools of the web app in a build."),
  // Deploy tooling.
  ALCHEMY_PASSWORD: host("Encrypts the deploy tool's state (packages/infra)."),
  DEPLOY_HOST: host("The server the deploy tool connects to (packages/infra)."),
  DEPLOY_DOMAIN: host("The domain the deploy tool serves Zetta on."),
  DEPLOY_SSH_USER: host("The admin user the deploy tool logs in as."),
  DEPLOY_SSH_PORT: host("The SSH port of that server."),
  DEPLOY_SSH_KEY: host("Path of the SSH key the deploy tool uses."),
  DEPLOY_ACME_EMAIL: host("Where certificate notices of the deployed server go."),
  // Names the server only SETS, for a process it starts, or shows to a person. They are not configuration it reads.
  ZETTA_INPUTS: host("Set by the server for a playground run: the inputs of the run."),
  ZETTA_LIVE_DIR: host("Set by the server for a bot's shell: where live output goes."),
  ZETTA_SHELL: host("Set by the server's shell wrapper for its own child."),
  ZETTA_RUN_TOOLS_TOKEN: host("Set by the server for a run: the token of its tools."),
  ZETTA_GITHUB_AUTH: host("Set by the server for a run: the GitHub login it hands to the CLI."),
  ZETTA_DIR: host("Named in the update page text for the installer; the server never reads it."),
  // Test infrastructure that lives in a source file (not a test file).
  ZETTA_TEST_GREENMAIL: host("Test infrastructure: starts a mail server for tests."),
  ZETTA_GREENMAIL_IMAGE: host("Test infrastructure: the image of that mail server."),
};

/**
 * The end state of the program that moved product settings out of the environment: **this list is empty and must stay empty.** It used to
 * hold names that were allowed for now while a reader was moved to the database. A new product setting is never added here: it goes in
 * the registry (`./settings.ts`), an installation setting or a sealed connection, and a host-level variable goes on `HOST_ENV` with its
 * reason. `host-env.test.ts` fails if this list has an entry.
 */
export const MIGRATING: Readonly<Record<string, string>> = {};

/**
 * Names that are built from a prefix at run time. A name that equals the prefix, or starts with it followed by `_` or a digit, is allowed.
 */
export const NAME_PREFIXES: readonly { prefix: string; kind: HostEnvKind; reason: string }[] = [
  {
    prefix: "ZETTA_PLAYGROUND_IMAGE",
    kind: "host",
    reason:
      "`ZETTA_PLAYGROUND_IMAGE_<BIN>`: the image of the playground runner for one program (for example _PYTHON3).",
  },
  {
    prefix: "ZETTA_MCP_TOKEN",
    kind: "host",
    reason:
      "`ZETTA_MCP_TOKEN_<n>`: set by the server in the environment of a local MCP command, never read.",
  },
];

/**
 * Reads whose name is not a literal, so the scan cannot see it. Each is listed by file and exact expression, with why it is host-level.
 * A new dynamic read fails the test until it is listed here.
 */
export const DYNAMIC_READS: readonly { file: string; expression: string; reason: string }[] = [
  {
    file: "apps/server/src/modules/chat/harness.ts",
    expression: "process.env[k]",
    reason:
      "Copies the platform variables in the `passed` list (HOME, PATH, TMP and the like) into a bot's process.",
  },
  {
    file: "apps/server/src/modules/integrations/plugins/vault/exec.ts",
    expression: "process.env[k]",
    reason:
      "Passes the trust-store names NODE_EXTRA_CA_CERTS, SSL_CERT_FILE and SSL_CERT_DIR on to a vault CLI (they name files, not secrets).",
  },
];
