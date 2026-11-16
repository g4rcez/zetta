# Skills marketplace: the real GitHub

Run: 2026-11-15 22:24 UTC. Result: **GREEN** (5 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/skills-market.ts`. Needs: network to api.github.com and raw.githubusercontent.com (no token).

| Check                                                                      | Result | Detail                                         |
| -------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| the commit of the default branch is a real sha                             | pass   | 1780c5e5a5                                     |
| the repository lists its skills, each with a description                   | pass   | 20 skills at 1780c5e5a5, 20 with a description |
| a skill is previewed at the commit it was listed at, with its files        | pass   | academy-guide: 1 files, warnings: none         |
| a search over the suggested repository finds a skill by a word of its name | pass   | "academy" -> 1 result(s)                       |
| a repository that does not exist is NOT_FOUND, not a crash                 | pass   |                                                |

## Notes

- Covers the read side (commit, list, describe, preview, search). Installing and the update check use the commit read here; the install into the database was tested with a fake GitHub and is not repeated.
