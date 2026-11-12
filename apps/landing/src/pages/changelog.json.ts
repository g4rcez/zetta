import changelog from "../data/changelog.json";

export const GET = () =>
  new Response(`${JSON.stringify(changelog, null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
