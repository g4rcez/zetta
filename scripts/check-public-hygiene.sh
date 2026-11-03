#!/usr/bin/env bash
# Public-repo hygiene check. Rules: "Public-repo hygiene" in CLAUDE.md.
#   check-public-hygiene.sh staged   lines added in the index (pre-commit)
#   check-public-hygiene.sh tracked  every tracked file (pre-push)
set -euo pipefail

mode="${1:-staged}"
cd "$(git rev-parse --show-toplevel)"

# Files that must never be tracked. .env.schema (names, no values) is the one allowed .env file.
forbidden_paths='(^|/)(\.env(\.[^/]*)?|\.omo|\.trash|\.certs|\.hutch|\.zetta-[^/]*|lsp\.json)(/|$)|(^|/)\.impeccable/(hook\.cache\.json|questions/)|(^|/)\.claude/(settings\.local\.json|scheduled_tasks\.lock|worktrees/)|\.(pem|key|p12|pfx|jks|keystore|sqlite3?|db)$'
allowed_paths='(^|/)\.env\.schema$'

# Home paths and personal email. /home/agent is the container user, not a person.
# A path starts at a word edge, so "project/home/profile" in prose does not match.
personal_data='(^|[^A-Za-z0-9_.-])(/Users/[A-Za-z0-9._-]+|/home/[a-z][a-z0-9._-]*)|[A-Za-z0-9._%+-]+@gmail\.com'
container_home='/home/agent$'

# Third-party content and the files that document these rules.
skip_content='^(\.agents/skills/|\.claude/skills/|\.github/prompts/|CLAUDE\.md$|scripts/check-public-hygiene\.sh$|bun\.lock$)'

case "$mode" in
staged) files=$(git diff --cached --name-only --diff-filter=ACMR) ;;
tracked) files=$(git ls-files) ;;
*) echo "usage: $0 staged|tracked" >&2; exit 2 ;;
esac

status=0

paths=$(printf '%s\n' "$files" | grep -E "$forbidden_paths" | grep -vE "$allowed_paths" || true)
if [ -n "$paths" ]; then
  echo "public-hygiene: these paths must not be in a public repo (add them to .gitignore, then git rm --cached):" >&2
  printf '  %s\n' $paths >&2
  status=1
fi

scan=$(printf '%s\n' "$files" | grep -vE "$skip_content" | grep -v '^$' || true)
hits=""
if [ -n "$scan" ]; then
  if [ "$mode" = staged ]; then
    while IFS= read -r file; do
      added=$(git diff --cached -U0 --no-color -- "$file" | grep -E '^\+' | grep -vE '^\+\+\+' | grep -oE "$personal_data" | grep -vE "$container_home" || true)
      [ -n "$added" ] && hits="$hits$(printf '%s\n' "$added" | sed "s|^|$file: |")"$'\n'
    done <<<"$scan"
  else
    hits=$(printf '%s\n' "$scan" | tr '\n' '\0' | xargs -0 git grep -nIoE "$personal_data" -- | grep -vE "$container_home" || true)
  fi
fi
if [ -n "$hits" ]; then
  echo "public-hygiene: personal data (home path or email) found. Use relative paths, homedir() or \${HOME}; fake values in fixtures:" >&2
  printf '%s\n' "$hits" | grep -v '^$' | sed 's/^/  /' >&2
  status=1
fi

exit "$status"
