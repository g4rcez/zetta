import { SITE } from "../links";

export const GET = () =>
  new Response(
    [
      "User-agent: *",
      "Allow: /",
      "",
      `# For language models: ${SITE}/llms.txt (an index of the Markdown pages) and ${SITE}/llms-full.txt (all of them in one file).`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
