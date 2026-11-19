/**
 * The preset pictures of a bot or a person, as data and SVG templates (no React). The server renders each one at
 * `/api/avatars/preset/<id>.svg?c=<colors>` so a list of bots carries a short URL instead of the drawing, and the browser caches
 * the file. Every template draws on a 64x64 canvas; shapes get a gradient of one color and a small face, characters take three colors.
 *
 * After changing a template or the math below, bump `AVATAR_ART_VERSION`: it is part of every URL, so caches pick up the new art.
 */
import type { AvatarValue } from "./avatar";

export const AVATAR_ART_VERSION = 1;

export type SidebarLayout =
  | "mail"
  | "compact"
  | "bubble"
  | "card"
  | "terminal"
  | "poster"
  | "banner"
  | "tile"
  | "outline"
  | "spotlight"
  | "ring"
  | "cozy"
  | "console"
  | "sticker"
  | "ribbon"
  | "glass";
export type AvatarShape = {
  id: string;
  label: string;
  layout: SidebarLayout;
  /** Where the face sits on the 64x64 canvas. */
  face: [number, number];
};
export type AvatarCharacter = {
  id: string;
  label: string;
  layout: SidebarLayout;
  colors: [string, string, string];
  colorLabels: [string, string, string];
};

/** Swatches offered in the picker; a preset's `colors[0]` is its base color (any hex is accepted). */
export const AVATAR_SWATCHES = [
  "#46a05f",
  "#4a80e6",
  "#c95454",
  "#dc8a42",
  "#7e5cc4",
  "#47a5c4",
  "#c8588a",
  "#cfa843",
  "#4aa396",
  "#d66b57",
];

/** Body shapes. Each is filled with a gradient of one customizable color and carries a small face. */
export const AVATAR_SHAPES: AvatarShape[] = [
  { id: "arrow", label: "Arrow", layout: "mail", face: [30, 29] },
  { id: "blob", label: "Blob", layout: "compact", face: [32, 32] },
  { id: "circle", label: "Circle", layout: "bubble", face: [32, 32] },
  { id: "square", label: "Square", layout: "card", face: [32, 32] },
  { id: "pill", label: "Pill", layout: "terminal", face: [32, 30] },
  { id: "drop", label: "Drop", layout: "poster", face: [32, 41] },
  { id: "bell", label: "Bell", layout: "banner", face: [32, 37] },
  { id: "hexagon", label: "Hexagon", layout: "tile", face: [32, 32] },
  { id: "diamond", label: "Diamond", layout: "outline", face: [32, 32] },
  { id: "star", label: "Star", layout: "spotlight", face: [32, 37] },
  { id: "triangle", label: "Triangle", layout: "card", face: [32, 40] },
  { id: "pentagon", label: "Pentagon", layout: "compact", face: [32, 33] },
  { id: "octagon", label: "Octagon", layout: "terminal", face: [32, 32] },
  { id: "cross", label: "Cross", layout: "banner", face: [32, 32] },
  { id: "arch", label: "Arch", layout: "poster", face: [32, 38] },
  { id: "parallelogram", label: "Parallelogram", layout: "mail", face: [32, 32] },
  { id: "kite", label: "Kite", layout: "bubble", face: [32, 30] },
  { id: "burst", label: "Burst", layout: "tile", face: [32, 32] },
];

/** Illustrated characters. Each takes three colors (background, body, accent). */
export const AVATAR_CHARACTERS: AvatarCharacter[] = [
  {
    id: "orbit",
    label: "Orbit",
    layout: "ring",
    colors: ["#0b0b0f", "#f4f4f5", "#7c7cff"],
    colorLabels: ["Background", "Planet", "Slash"],
  },
  {
    id: "mouse",
    label: "Mouse",
    layout: "cozy",
    colors: ["#fde68a", "#9ca3af", "#f9a8d4"],
    colorLabels: ["Background", "Fur", "Ears & nose"],
  },
  {
    id: "robot",
    label: "Robot",
    layout: "console",
    colors: ["#0f172a", "#94a3b8", "#22d3ee"],
    colorLabels: ["Background", "Casing", "Eyes & antenna"],
  },
  {
    id: "cat",
    label: "Cat",
    layout: "sticker",
    colors: ["#c7d2fe", "#f59e0b", "#fef3c7"],
    colorLabels: ["Background", "Fur", "Muzzle"],
  },
  {
    id: "owl",
    label: "Owl",
    layout: "ribbon",
    colors: ["#134e4a", "#a16207", "#fde047"],
    colorLabels: ["Background", "Feathers", "Beak & pupils"],
  },
  {
    id: "spark",
    label: "Spark",
    layout: "glass",
    colors: ["#312e81", "#fbbf24", "#f472b6"],
    colorLabels: ["Background", "Big star", "Small star"],
  },
  {
    id: "ghost",
    label: "Ghost",
    layout: "spotlight",
    colors: ["#1e1b4b", "#e0e7ff", "#f9a8d4"],
    colorLabels: ["Background", "Body", "Cheeks"],
  },
  {
    id: "rocket",
    label: "Rocket",
    layout: "outline",
    colors: ["#0c1a3a", "#e5e7eb", "#f97316"],
    colorLabels: ["Background", "Hull", "Fins & flame"],
  },
  {
    id: "frog",
    label: "Frog",
    layout: "bubble",
    colors: ["#fef9c3", "#4ade80", "#fb7185"],
    colorLabels: ["Background", "Skin", "Cheeks"],
  },
];

/** The drawing of each shape, filled with the gradient `url(#g)`; the gradient and the face are added by `shapeInner`. */
const SHAPE_ART: Record<string, string> = {
  arrow: [
    '<path d="M12 9Q14 4 19 7L56 34Q61 38 54 40L38 43L30 57Q27 62 24 56Z" fill="url(#g)"></path>',
  ].join(""),
  blob: [
    '<path d="M32 6C48 4 58 18 56 34C54 50 42 58 28 56C14 54 6 42 8 28C10 14 20 7 32 6Z" fill="url(#g)"></path>',
  ].join(""),
  circle: ['<circle cx="32" cy="32" r="26" fill="url(#g)"></circle>'].join(""),
  square: ['<rect x="7" y="7" width="50" height="50" rx="14" fill="url(#g)"></rect>'].join(""),
  pill: ['<rect x="14" y="5" width="36" height="54" rx="18" fill="url(#g)"></rect>'].join(""),
  drop: [
    '<path d="M32 5C40 17 54 26 54 40C54 52 44 59 32 59C20 59 10 52 10 40C10 26 24 17 32 5Z" fill="url(#g)"></path>',
  ].join(""),
  bell: ['<path d="M22 8Q32 4 42 8L56 52Q57 58 50 58H14Q7 58 8 52Z" fill="url(#g)"></path>'].join(
    "",
  ),
  hexagon: [
    '<polygon points="32,7 54,19 54,45 32,57 10,45 10,19" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  diamond: [
    '<rect x="15" y="15" width="34" height="34" rx="5" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round" transform="rotate(45 32 32)"></rect>',
  ].join(""),
  star: [
    '<polygon points="32.0,8.0 39.1,25.3 57.7,26.7 43.4,38.7 47.9,56.8 32.0,47.0 16.1,56.8 20.6,38.7 6.3,26.7 24.9,25.3" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  triangle: [
    '<polygon points="32,9 56,52 8,52" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  pentagon: [
    '<polygon points="32.0,7.0 56.7,25.0 47.3,54.0 16.7,54.0 7.3,25.0" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  octagon: [
    '<polygon points="41.9,8.0 56.0,22.1 56.0,41.9 41.9,56.0 22.1,56.0 8.0,41.9 8.0,22.1 22.1,8.0" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  cross: [
    '<polygon points="24,8 40,8 40,24 56,24 56,40 40,40 40,56 24,56 24,40 8,40 8,24 24,24" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  arch: [
    '<path d="M10 57V32A22 22 0 0 1 54 32V57Z" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></path>',
  ].join(""),
  parallelogram: [
    '<polygon points="20,10 58,10 44,54 6,54" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  kite: [
    '<polygon points="32,6 54,28 32,58 10,28" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
  burst: [
    '<polygon points="32.0,5.0 40.4,11.7 51.1,12.9 52.3,23.6 59.0,32.0 52.3,40.4 51.1,51.1 40.4,52.3 32.0,59.0 23.6,52.3 12.9,51.1 11.7,40.4 5.0,32.0 11.7,23.6 12.9,12.9 23.6,11.7" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"></polygon>',
  ].join(""),
};

/** The drawing of each character; `{{c0}}` is the background, `{{c1}}` the body, `{{c2}}` the accent and `{{ink}}` the eye color on the body. */
const CHARACTER_ART: Record<string, string> = {
  orbit: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<circle cx="32" cy="32" r="13" fill="{{c1}}"></circle>',
    '<ellipse cx="32" cy="32" rx="25" ry="9" fill="none" stroke="{{c2}}" stroke-width="3.5" transform="rotate(-28 32 32)"></ellipse>',
    '<path d="M14 52 50 12" stroke="{{c2}}" stroke-width="3.5" stroke-linecap="round"></path>',
  ].join(""),
  mouse: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<circle cx="15" cy="17" r="11" fill="{{c1}}"></circle>',
    '<circle cx="49" cy="17" r="11" fill="{{c1}}"></circle>',
    '<circle cx="15" cy="17" r="6" fill="{{c2}}"></circle>',
    '<circle cx="49" cy="17" r="6" fill="{{c2}}"></circle>',
    '<ellipse cx="32" cy="38" rx="20" ry="18" fill="{{c1}}"></ellipse>',
    '<circle cx="24" cy="34" r="3" fill="{{ink}}"></circle>',
    '<circle cx="40" cy="34" r="3" fill="{{ink}}"></circle>',
    '<ellipse cx="32" cy="43" rx="3.5" ry="2.8" fill="{{c2}}"></ellipse>',
    '<path d="M10 40h9M10 46l9-3M54 40h-9M54 46l-9-3" stroke="#1b1b1f" stroke-width="1.5" stroke-linecap="round"></path>',
  ].join(""),
  robot: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<path d="M32 8v8" stroke="{{c2}}" stroke-width="3" stroke-linecap="round"></path>',
    '<circle cx="32" cy="8" r="3.5" fill="{{c2}}"></circle>',
    '<rect x="10" y="16" width="44" height="36" rx="9" fill="{{c1}}"></rect>',
    '<rect x="17" y="26" width="10" height="9" rx="3" fill="{{c2}}"></rect>',
    '<rect x="37" y="26" width="10" height="9" rx="3" fill="{{c2}}"></rect>',
    '<path d="M22 43h20" stroke="{{c0}}" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"></path>',
  ].join(""),
  cat: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<path d="M10 28 12 6l16 12zM54 28 52 6 36 18z" fill="{{c1}}"></path>',
    '<circle cx="32" cy="36" r="22" fill="{{c1}}"></circle>',
    '<ellipse cx="32" cy="44" rx="10" ry="7" fill="{{c2}}"></ellipse>',
    '<ellipse cx="23" cy="33" rx="2.5" ry="3.5" fill="{{ink}}"></ellipse>',
    '<ellipse cx="41" cy="33" rx="2.5" ry="3.5" fill="{{ink}}"></ellipse>',
    '<path d="M29 41h6l-3 3z" fill="#1b1b1f"></path>',
    '<path d="M6 36h10M6 42l10-2M58 36H48M58 42l-10-2" stroke="#1b1b1f" stroke-width="1.5" stroke-linecap="round"></path>',
  ].join(""),
  owl: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<path d="M12 10 22 18H42L52 10V40C52 50 43 58 32 58S12 50 12 40z" fill="{{c1}}"></path>',
    '<circle cx="23" cy="30" r="9" fill="#fff"></circle>',
    '<circle cx="41" cy="30" r="9" fill="#fff"></circle>',
    '<circle cx="23" cy="30" r="4.5" fill="{{c2}}"></circle>',
    '<circle cx="41" cy="30" r="4.5" fill="{{c2}}"></circle>',
    '<circle cx="23" cy="30" r="2" fill="#1b1b1f"></circle>',
    '<circle cx="41" cy="30" r="2" fill="#1b1b1f"></circle>',
    '<path d="M28 38h8l-4 8z" fill="{{c2}}"></path>',
  ].join(""),
  spark: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<path d="M30 8c2 14 8 20 22 22-14 2-20 8-22 22-2-14-8-20-22-22 14-2 20-8 22-22z" fill="{{c1}}"></path>',
    '<path d="M50 36c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" fill="{{c2}}"></path>',
  ].join(""),
  ghost: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<path d="M15 56V30C15 18 22 9 32 9S49 18 49 30V56L43 50L37.5 56L32 50L26.5 56L21 50Z" fill="{{c1}}"></path>',
    '<ellipse cx="26" cy="29" rx="3" ry="4" fill="{{ink}}"></ellipse>',
    '<ellipse cx="38" cy="29" rx="3" ry="4" fill="{{ink}}"></ellipse>',
    '<circle cx="20.5" cy="37" r="3" fill="{{c2}}"></circle>',
    '<circle cx="43.5" cy="37" r="3" fill="{{c2}}"></circle>',
    '<ellipse cx="32" cy="38" rx="3" ry="4" fill="#1b1b1f"></ellipse>',
  ].join(""),
  rocket: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<circle cx="11" cy="13" r="1.5" fill="{{c1}}"></circle>',
    '<circle cx="53" cy="18" r="1.5" fill="{{c1}}"></circle>',
    '<circle cx="50" cy="55" r="1.5" fill="{{c1}}"></circle>',
    '<path d="M26 46Q32 66 38 46Z" fill="{{c2}}"></path>',
    '<path d="M25 34 14 50l12-4zM39 34l11 16-12-4z" fill="{{c2}}"></path>',
    '<path d="M32 5C43 14 45 30 42 47H22C19 30 21 14 32 5z" fill="{{c1}}"></path>',
    '<circle cx="32" cy="26" r="6" fill="{{c0}}" stroke="{{c2}}" stroke-width="2.5"></circle>',
  ].join(""),
  frog: [
    '<rect width="64" height="64" fill="{{c0}}"></rect>',
    '<ellipse cx="32" cy="41" rx="23" ry="17" fill="{{c1}}"></ellipse>',
    '<circle cx="19" cy="23" r="10" fill="{{c1}}"></circle>',
    '<circle cx="45" cy="23" r="10" fill="{{c1}}"></circle>',
    '<circle cx="19" cy="23" r="6.5" fill="#fff"></circle>',
    '<circle cx="45" cy="23" r="6.5" fill="#fff"></circle>',
    '<circle cx="20" cy="24" r="3.2" fill="#1b1b1f"></circle>',
    '<circle cx="44" cy="24" r="3.2" fill="#1b1b1f"></circle>',
    '<circle cx="14" cy="43" r="3.5" fill="{{c2}}"></circle>',
    '<circle cx="50" cy="43" r="3.5" fill="{{c2}}"></circle>',
    '<path d="M20 45Q32 54 44 45" fill="none" stroke="#1b1b1f" stroke-width="2.2" stroke-linecap="round"></path>',
    '<path d="M29 36h.1M35 36h.1" stroke="#1b1b1f" stroke-width="2.4" stroke-linecap="round"></path>',
  ].join(""),
};

export const shapeOf = (id: string) => AVATAR_SHAPES.find((s) => s.id === id);
export const characterOf = (id: string) => AVATAR_CHARACTERS.find((c) => c.id === id);
export const layoutOf = (a?: AvatarValue | null): SidebarLayout | undefined =>
  a?.kind === "preset" ? (shapeOf(a.preset) ?? characterOf(a.preset))?.layout : undefined;
/** The color a sidebar row is tinted with: a shape's only color, or a character's accent. */
export const avatarColor = (a?: AvatarValue | null) =>
  a?.kind === "preset"
    ? characterOf(a.preset)
      ? (a.colors[2] ?? characterOf(a.preset)!.colors[2])
      : a.colors[0]
    : undefined;

/** Mixes a hex color toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16),
    target = amount < 0 ? 0 : 255,
    t = Math.abs(amount);
  const ch = (shift: number) =>
    Math.round(((n >> shift) & 255) * (1 - t) + target * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/**
 * The face every shape wears, on the 64x64 canvas: two rounded-square eyes (the Grok Bot face), the same proportions as the
 * generated avatar (10% wide, 16% tall, centres 26% apart). `spread` is half the distance between the centres.
 */
const EYE = { w: 6.4, h: 10.2, r: 2.4, spread: 8.3 };

/** WCAG relative luminance of a `#rrggbb` color. */
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
/** Black or white, whichever has more contrast with `hex`: black wins when the color is brighter than about 0.18 luminance. */
export const inkOn = (hex: string) => (luminance(hex) > 0.179 ? "#000" : "#fff");
/** The eye color for a shape: the gradient's tone under the face (the gradient runs 35% toward white to 25% toward black, corner to corner). */
export const eyeInk = (base: string, [fx, fy]: [number, number]) =>
  inkOn(shade(base, 0.35 - 0.6 * ((fx + fy) / 128)));

const HEX = /^#[0-9a-f]{6}$/;
const colorOr = (c: string | undefined, fallback: string) => {
  const lower = c?.toLowerCase();
  return lower !== undefined && HEX.test(lower) ? lower : fallback;
};

/** The colors a preset is drawn with, every slot filled (one for a shape, three for a character) and lowercase; null for an unknown preset. */
export function presetColors(id: string, colors: readonly string[]): string[] | null {
  const shape = shapeOf(id);
  if (shape) return [colorOr(colors[0], AVATAR_SWATCHES[0]!)];
  const character = characterOf(id);
  if (character) return character.colors.map((d, i) => colorOr(colors[i], d));
  return null;
}

function shapeInner(id: string, face: [number, number], base: string) {
  const [fx, fy] = face;
  const ink = eyeInk(base, face);
  const eyes = [-1, 1]
    .map(
      (side) =>
        `<rect x="${fx + side * EYE.spread - EYE.w / 2}" y="${fy - EYE.h / 2}" width="${EYE.w}" height="${EYE.h}" rx="${EYE.r}" fill="${ink}" fill-opacity="0.8"></rect>`,
    )
    .join("");
  return (
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(base, 0.35)}"></stop>` +
    `<stop offset="1" stop-color="${shade(base, -0.25)}"></stop></linearGradient></defs>${SHAPE_ART[id]}${eyes}`
  );
}

/** What goes inside the `<svg>` of a preset, or null for an unknown preset or one without art. Colors that are not `#rrggbb` fall back to the preset's own. */
export function presetInner(id: string, colors: readonly string[]): string | null {
  const full = presetColors(id, colors);
  if (!full) return null;
  const shape = shapeOf(id);
  if (shape) return SHAPE_ART[id] ? shapeInner(id, shape.face, full[0]!) : null;
  const art = CHARACTER_ART[id];
  if (!art) return null;
  const [c0, c1, c2] = full as [string, string, string];
  return art
    .replaceAll("{{c0}}", c0)
    .replaceAll("{{c1}}", c1)
    .replaceAll("{{c2}}", c2)
    .replaceAll("{{ink}}", inkOn(c1));
}

/** A standalone SVG file for a preset (what `/api/avatars/preset/<id>.svg` serves), or null for an unknown preset. */
export function renderPresetSvg(id: string, colors: readonly string[]): string | null {
  const inner = presetInner(id, colors);
  return inner === null
    ? null
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${inner}</svg>`;
}

/** `#46a05f-#4a80e6` style color list of a preset URL, without the `#`: dash separated lowercase hex. */
const COLOR_QUERY = /^[0-9a-f]{6}(-[0-9a-f]{6}){0,3}$/;
/** The colors in a preset URL's `c` query, or null when it is not a dash separated list of 1 to 4 hex colors. */
export const parseColorQuery = (q: string | undefined): string[] | null =>
  q !== undefined && COLOR_QUERY.test(q) ? q.split("-").map((c) => `#${c}`) : null;

/** The canonical URL of a preset picture: one URL per look, so the browser cache is shared by every bot that looks the same. */
export function presetAvatarUrl(id: string, colors: readonly string[]): string | null {
  const full = presetColors(id, colors);
  if (!full) return null;
  return `/api/avatars/preset/${id}.svg?c=${full.map((c) => c.slice(1)).join("-")}&v=${AVATAR_ART_VERSION}`;
}
