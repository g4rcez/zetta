# Skills

Your skills live in **Skills** (sidebar). A skill is a how-to a bot reads when a job matches. You write it here or install it from GitHub, then choose which bots bring it.

## Finding and tidying

- **Search, Where from, Order, Bot** narrow the list. **Unused** shows skills no bot used in the last 30 days. **Removed** shows what you deleted. All of it is in the address, so a link shows the same view.
- Each skill shows its size and how it was used ("Used 3 times in 30 days, last 2d ago", "Never used"). Use is counted when you pick a skill with `/` and when Claude Code loads it.
- **Restore** brings a removed skill back with the bots that had it. If another skill took the name, rename one first.
- Tick skills to **Give to bots**, **Take from bots** or **Remove** several at once. A bot that already has the most skills it can bring is left out and named.

## One skill

- **History** lists every save. Pick one to see what changed up to now and **Put this version back**. Going back is a new save, so nothing is lost; the last 50 are kept.
- **Edit** shows live notes under the form: how big it is, what would stop the save, a warning when it takes a lot of a Hermes bot's prompt, and skills you already have that look the same.
- **Files**: open "N files next to SKILL.md" to add a text file, change one or remove one. Limits: 1 MB a file, 200 files, 4 MB in all. A file that looks like it holds a key is refused.
- **Export** saves the skill and its folder as a zip. **Import a skill folder (.zip)** (in New skill) makes a skill from one: `SKILL.md` at the top or in its one folder, with a description.

## Skills from GitHub

**Check GitHub for updates** looks at each repository a skill came from. A skill is marked when its own text or files changed there, not just because the repository moved. **Update** replaces it. If you changed the skill after installing it, you are asked first, and your text stays in the history.

## What a bot has

In a bot's settings (Claude Code and Hermes bots), **All the skills** lists everything it has: from your library, written for this bot, built in, and from the server, with sizes. It tells you when a library skill is hidden by a skill of the bot's own with the same name. For Hermes it shows how much of the 48 KB prompt budget the skills use and which no longer fit and are left out. You can take a library skill away or add one there.

## The chief

The chief can read a skill, create, rename or change one (up to 64 KB), give it to bots or take it away, delete it and bring it back. Every change is a card you approve.
