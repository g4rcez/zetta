import changelog from "../data/changelog.json";
import { changelogMarkdown, type ChangelogDay } from "../machine/changelog";

export const GET = () =>
  new Response(changelogMarkdown(changelog as ChangelogDay[]), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
