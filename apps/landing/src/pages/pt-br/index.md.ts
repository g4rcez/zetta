import { pageMarkdown } from "../../machine/page-md";

export const GET = () =>
  new Response(pageMarkdown("pt-br"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
