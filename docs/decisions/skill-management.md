# Skill management

The skills library (`modules/skills`, `features/skills`) had one list and a save that overwrote the text. This record covers how it is managed now. Built 2026-11-08 together with Zetta Apps ([apps.md](apps.md)).

## What was missing

No search, filter, sort, bulk change or usage; a removed skill could not be seen or brought back; a save overwrote the text with no way back; a skill from GitHub could not be updated; a bot's skills from every place were never shown together, and a library skill hidden by a bot's own skill of the same name, or dropped by Hermes' 48 KB budget, vanished silently; the chief's tool could not read, detach, rename or restore and capped a body at 24 KB.

## Decisions

- **Filters live in the address** (`find`, `source`, `sort`, `bot`, `view=archived`, `use=unused`); the API takes the same parameters (`GET /api/skills`). A parameter the API does not know is a 400.
- **Usage is a small table, not a counter.** `skill_use(skill_id, bot_id, source picked|run, used_at)`, pruned to 90 days when the skill is used again. It is written when a skill is picked with `/` (`pickedSkills`) and when a Claude Code run reports `Using skill <name>`. Only library skills attached to that bot count. A failure to write it never stops a turn. "Unused" means no use in 30 days.
- **Removed is archived.** The list shows archived skills with `status=archived`; **Restore** brings one back with its bots (the links were kept). A name another skill took since is refused with `DUPLICATE`.
- **Bulk** (`POST /api/skills/bulk`): attach, detach or archive several skills; attach and detach take bots. Everything must be the caller's or nothing happens. A bot that would pass the 25-skill limit is skipped and named; the others still get the skills.
- **What a bot has** (`GET /api/bots/:id/skills/overview`, `skills/overview.ts`): library, written-for-this-bot, built-in and host skills, with size, which library skill a bot's own hides, which library skill is unusable, and for Hermes the budget meter and which skills are left out. The cost formula is a copy of `hermesPrompt`'s; a test builds a real Hermes prompt and checks both agree.
- **History** (`skill_revision`, migration `20261108063942_skill_revision`): an immutable copy after each content save (create, edit, put back, update from GitHub, file change), the last 50 kept, with a fingerprint of the folder (`files_hash`) so a revision says whether the files changed without keeping them. The page shows a line diff against the skill now. **Putting a version back is a new save**, and a stale page is refused with `CONFLICT`. The migration backfills one revision per existing skill.
- **Update from GitHub.** `GET /api/skills/updates` asks GitHub for each repository's current commit (one question per repository, at most 25 skills). Only a repository that moved is read further, and a skill is an `update` only when its own text or folder differs from what is stored, so a busy repository does not flag everything. `POST /api/skills/:id/update` applies it with the same checks as an install. `skill.source_state` (`pristine` | `edited`) is set to `edited` when the owner changes an installed skill (text or files); an `edited` skill is not overwritten unless the request says `overwriteEdited`, and the check happens before GitHub is asked. The owner's text stays in the history either way. The migration marks an already-saved GitHub skill (`version > 1`) as `edited`.
- **Checks before saving** (`POST /api/skills/check`): the same rules as a save, plus size, a warning when a skill would take over half the Hermes budget, and the person's skills that look the same (same name stem, or at least 40 % shared words). `skills.integration` tests that the check and a real save agree on a set of drafts.
- **The folder is editable** for the owner (`PUT /api/skills/:id/files`, `POST …/files/remove`, `GET …/file?path=`): the limits and the credential screen of an install (1 MB a file, 200 files, 4 MB in all), a path rule shared with GitHub folders, and each change is a save. Text opens in an editor; other files can be removed, not edited here.
- **Export and import as a zip** are done in the browser with `fflate` (`skill-zip.ts`): `<name>/SKILL.md` plus the folder. Import reads the sizes from the zip index before unpacking, so a zip bomb stops early; paths that leave the folder, junk (`__MACOSX`, `.git`) and a missing or duplicate SKILL.md are handled. The executable bit is not read from a zip: a file that starts with `#!` is marked executable.
- **Chief parity** (`chat/chief/skill-library.ts`): `read` (framed as untrusted data), `detach`, `restore`, `rename` (through `update`), and the 64 KB body limit of the library. Every change is still a card.

## Not done

- Usage is counted for Claude Code and the `/` picker only; a Hermes run puts every attached skill in its prompt, so "used" there would mean "attached". Other harnesses are not counted.
- The update check compares against the repository's default branch (HEAD) only, not a branch or tag.
- A zip cannot keep the executable bit, and the folder editor cannot edit files that are not text.
- No bulk "update all".
- Not verified in a real browser (happy-dom only), and the update flow was run against a fake GitHub, not the real API.
