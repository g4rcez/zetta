// The pieces every remote script is made of. A step is plain bash that runs as root, checks before it changes anything, and writes a
// file only when its content, mode or owner differ, so running it twice changes nothing.

/** A value as one single-quoted shell word. */
export const quote = (value: string | number) => `'${String(value).replaceAll("'", `'\\''`)}'`;

const HEREDOC = "__FILE__";

export type FileSpec = {
  path: string;
  content: string;
  /** Octal mode as four digits, e.g. "0644". */
  mode?: string;
  owner?: string;
  group?: string;
};

/** Shell that writes a file through `put_file`; `$WROTE` is 1 afterwards when the file changed. */
export function file({ path, content, mode = "0644", owner = "root", group = owner }: FileSpec) {
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (body.split("\n").includes(HEREDOC)) throw new Error(`${path} holds the heredoc marker.`);
  return `put_file ${quote(path)} ${mode} ${owner} ${group} <<'${HEREDOC}'\n${body}\n${HEREDOC}`;
}

/** Writes a file and remembers in `$flag` (set it to 0 first) that something changed, so a service restarts only then. */
export const trackedFile = (flag: string, spec: FileSpec) =>
  `${file(spec)}\n${flag}=$((${flag} | WROTE))`;

const PRELUDE = `set -euo pipefail
export LC_ALL=C
CHANGED=0
WROTE=0
note() { printf '    %s\\n' "$*"; }
fail() { printf 'error: %s\\n' "$*" >&2; exit 1; }
changed() { CHANGED=1; note "changed: $*"; }
put_file() {
  local path=$1 mode=$2 owner=$3 group=$4 tmp
  WROTE=0
  tmp=$(mktemp)
  cat >"$tmp"
  if [ -f "$path" ] && cmp -s "$tmp" "$path" && [ "$(stat -c '%a %U %G' "$path")" = "\${mode#0} $owner $group" ]; then
    rm -f "$tmp"
    return 0
  fi
  install -D -m "$mode" -o "$owner" -g "$group" "$tmp" "$path"
  rm -f "$tmp"
  WROTE=1
  changed "$path"
}
ensure_dir() {
  local path=$1 mode=$2 owner=$3 group=$4
  if [ -d "$path" ] && [ "$(stat -c '%a %U %G' "$path")" = "\${mode#0} $owner $group" ]; then return 0; fi
  install -d -m "$mode" -o "$owner" -g "$group" "$path"
  changed "$path/"
}
# Enables and starts a unit that is not already running.
ensure_running() {
  local unit=$1
  if ! systemctl is-enabled --quiet "$unit"; then systemctl enable --quiet "$unit"; changed "enabled $unit"; fi
  if ! systemctl is-active --quiet "$unit"; then systemctl start "$unit"; changed "started $unit"; fi
}`;

/**
 * A whole script. Everything is inside one group whose stdin is /dev/null: the script itself arrives on bash's stdin over SSH, so a
 * command that reads stdin would otherwise eat the rest of it. bash reads the full group before it runs the first line.
 */
export const script = (body: string) =>
  `{\n${PRELUDE}\n\n${body.trim()}\n\nif [ "$CHANGED" = 0 ]; then note "no changes"; fi\n} </dev/null\n`;

export type Step = {
  id: string;
  title: string;
  script: string;
};

export const step = (id: string, title: string, body: string): Step => ({
  id,
  title,
  script: script(body),
});
