import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AVATAR_CHARACTERS, AVATAR_SHAPES, BotAvatar, type AvatarValue } from "./bot-avatar";

const render = (avatar: AvatarValue | null | undefined, extra?: { kind?: "chief" }) =>
  renderToStaticMarkup(<BotAvatar bot={{ id: "bot-1", avatar, ...extra }} size={44} />);

test("a shape is an image of its template with the bot's color, never inline svg", () => {
  const html = render({ kind: "preset", preset: "circle", colors: ["#4A80E6"] });
  expect(html).toContain('src="/api/avatars/preset/circle.svg?c=4a80e6&amp;v=1"');
  expect(html).toContain('width="44"');
  expect(html).toContain("drop-shadow-sm");
  expect(html).not.toContain("<svg");
});

test("a character keeps its three colors and its clipped corners", () => {
  const html = render({
    kind: "preset",
    preset: "robot",
    colors: ["#0f172a", "#94a3b8", "#22d3ee"],
  });
  expect(html).toContain("/api/avatars/preset/robot.svg?c=0f172a-94a3b8-22d3ee");
  expect(html).toContain("border-radius:50%");
  expect(html).not.toContain("<svg");
});

test("every preset resolves to an image", () => {
  for (const p of [...AVATAR_SHAPES, ...AVATAR_CHARACTERS])
    expect(render({ kind: "preset", preset: p.id, colors: [] })).toContain(
      `/api/avatars/preset/${p.id}.svg`,
    );
});

test("an uploaded picture keeps its src (a URL from the server, or a data URL before it is saved)", () => {
  expect(render({ kind: "image", src: "/api/avatars/bot/abc?v=1" })).toContain(
    'src="/api/avatars/bot/abc?v=1"',
  );
});

test("an unknown preset or no picture falls back to the generated face", () => {
  expect(render({ kind: "preset", preset: "gone", colors: ["#4a80e6"] })).not.toContain("<img");
  expect(render(null)).not.toContain("<img");
});
