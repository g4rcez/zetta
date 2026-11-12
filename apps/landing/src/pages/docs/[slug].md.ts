// One Markdown page per page of the user guide (docs/wiki/user-guide).
import type { APIRoute, GetStaticPaths } from "astro";

import { guidePages } from "../../machine/guide";

export const getStaticPaths = (() =>
  guidePages().map((p) => ({
    params: { slug: p.slug },
    props: { markdown: p.markdown },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(props.markdown as string, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
