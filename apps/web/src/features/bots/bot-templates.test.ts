import { expect, test } from "bun:test";

import { isAvatarValue } from "@zetta/core/avatar";
import { AVATAR_SWATCHES, characterOf, shapeOf, type AvatarValue } from "@/components/bot-avatar";
import {
  BOT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  sameAvatar,
  templateById,
  templateInput,
  templateSettings,
  templateSteps,
  templateTools,
} from "./bot-templates";

test("every template has the fields a bot needs", () => {
  for (const t of BOT_TEMPLATES) {
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.title.length).toBeLessThanOrEqual(80);
    // A card shows one plain sentence.
    expect(t.description.length).toBeGreaterThan(20);
    expect(t.description.length).toBeLessThanOrEqual(110);
    expect(t.personality.length).toBeLessThanOrEqual(4096);
    expect(t.instructions.length).toBeLessThanOrEqual(16384);
    expect(t.starters).toHaveLength(3);
    expect(TEMPLATE_CATEGORIES.map((c) => c.id)).toContain(t.category);
  }
});

test("ids and titles are unique, so a card and a bot name identify one template", () => {
  expect(new Set(BOT_TEMPLATES.map((t) => t.id)).size).toBe(BOT_TEMPLATES.length);
  expect(new Set(BOT_TEMPLATES.map((t) => t.title)).size).toBe(BOT_TEMPLATES.length);
});

test("each template has its own valid picture from the avatar set", () => {
  for (const t of BOT_TEMPLATES) {
    // The server rejects anything else, so “Create now” would fail.
    expect(isAvatarValue(t.avatar)).toBe(true);
    expect(shapeOf(t.avatar.preset) ?? characterOf(t.avatar.preset)).toBeDefined();
    expect(AVATAR_SWATCHES).toContain(t.avatar.colors[0]!);
  }
  const pictures = BOT_TEMPLATES.map((t) => `${t.avatar.preset}:${t.avatar.colors[0]}`);
  expect(new Set(pictures).size).toBe(BOT_TEMPLATES.length);
});

test("every category has at least one template", () => {
  for (const c of TEMPLATE_CATEGORIES)
    expect(BOT_TEMPLATES.some((t) => t.category === c.id)).toBe(true);
});

test("tools name catalog-style ids and say why", () => {
  for (const t of BOT_TEMPLATES)
    for (const tool of t.tools) {
      expect(tool.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(tool.why.length).toBeGreaterThan(10);
      expect(["required", "suggested"]).toContain(tool.need);
    }
});

test("only code templates get a code directory", () => {
  const withCode = BOT_TEMPLATES.filter((t) => t.code === "on").map((t) => t.id);
  expect(withCode.sort()).toEqual(["analyst", "engineer", "reviewer"]);
});

test("create-now input carries everything the template defines", () => {
  const t = templateById("researcher")!;
  expect(templateInput(t)).toEqual({
    name: "Researcher",
    description: t.description,
    avatar: t.avatar,
    personality: t.personality,
    instructions: t.instructions,
    outputStyle: "default",
    outputStyleId: null,
    computerMode: "browser",
    codeAccess: false,
  });
  expect(templateInput(templateById("engineer")!).codeAccess).toBe(true);
});

test("settings are listed in plain words", () => {
  expect(templateSettings(templateById("researcher")!)).toEqual([
    { label: "Output style", value: "Default" },
    { label: "Computer use", value: "Browser" },
    { label: "Code access", value: "Off" },
  ]);
});

test("sameAvatar compares a preset by shape and color, never an uploaded image", () => {
  const a: AvatarValue = { kind: "preset", preset: "owl", colors: ["#4a80e6"] };
  expect(sameAvatar(a, { kind: "preset", preset: "owl", colors: ["#4a80e6"] })).toBe(true);
  expect(sameAvatar(a, { kind: "preset", preset: "owl", colors: ["#c95454"] })).toBe(false);
  expect(sameAvatar(a, null)).toBe(false);
  const img: AvatarValue = { kind: "image", src: "data:image/png;base64,AAAA" };
  expect(sameAvatar(img, img)).toBe(false);
});

test("the preview lists the numbered steps, without their numbers", () => {
  const steps = templateSteps(templateById("researcher")!);
  expect(steps).toHaveLength(4);
  expect(steps[0]).toBe("Restate the question in one sentence so the person can correct it early.");
  expect(templateSteps(templateById("researcher")!, 2)).toHaveLength(2);
  for (const t of BOT_TEMPLATES) expect(templateSteps(t).length).toBeGreaterThanOrEqual(3);
});

test("a plugin is required only where the job cannot be done without it, and required ones come first", () => {
  const required = BOT_TEMPLATES.flatMap((t) =>
    t.tools.filter((x) => x.need === "required").map((x) => `${t.id}:${x.id}`),
  );
  expect(required).toEqual(["reviewer:github"]);
  const sorted = templateTools({
    ...templateById("engineer")!,
    tools: [
      { id: "a", why: "first suggested", need: "suggested" },
      { id: "b", why: "second required", need: "required" },
    ],
  });
  expect(sorted.map((x) => x.id)).toEqual(["b", "a"]);
});
