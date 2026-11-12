// The home page as Markdown, built from the same words as the page (src/locales/en.json).
import { pageMarkdown } from "../machine/page-md";

export const GET = () =>
  new Response(pageMarkdown("en"), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
