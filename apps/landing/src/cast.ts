// The page's illustrations are the product's own bot art (see the avatars below). DESIGN.md exempts avatar art from the
// token and gradient rules, so the colors here are the art's own.
import github from "./assets/logos/github.svg";
import linear from "./assets/logos/linear.svg";
import notion from "./assets/logos/notion.png";
import posthog from "./assets/logos/posthog.svg";
import sentry from "./assets/logos/sentry.png";
import cloudflare from "./assets/logos/cloudflare.png";
import whatsapp from "./assets/logos/whatsapp.svg";
import playwright from "./assets/logos/playwright.svg";
import postgresql from "./assets/logos/postgresql.svg";
import onepassword from "./assets/logos/1password.svg";
import bitwarden from "./assets/logos/bitwarden.svg";
import context7 from "./assets/logos/context7.png";
import chromeDevtools from "./assets/logos/chrome-devtools.png";
import google from "./assets/logos/google.svg";
import telegram from "./assets/logos/telegram.svg";
// The coding agents a bot can run on. Each mark is the project's own: Claude Code and Codex and Cursor and OpenCode from the lobe-icons set,
// OMP from assets/icon.svg of https://github.com/can1357/oh-my-pi, Pi from the apps/p2 favicon of https://github.com/earendil-works/pi.
import claudeCode from "./assets/logos/agents/claude-code.svg";
import codex from "./assets/logos/agents/codex.svg";
import cursor from "./assets/logos/agents/cursor.svg";
import opencode from "./assets/logos/agents/opencode.svg";
import omp from "./assets/logos/agents/omp.svg";
import pi from "./assets/logos/agents/pi.svg";

// The bots are drawn as the app's geometric avatars: a shape filled with a gradient of one color, with a small white face.
// Ported from AVATAR_SHAPES in apps/web/src/components/bot-avatar.tsx (same paths, same face positions, same gradient: the color
// mixed 35% toward white at the top left and 25% toward black at the bottom right). Change the art in the app first, then here.
export type ArtId = "blob" | "hexagon" | "drop" | "bell" | "pill" | "square" | "circle" | "diamond";

const ROUNDED = 'stroke-width="5" stroke-linejoin="round"';
const SHAPES: Record<ArtId, { face: [number, number]; draw: (fill: string) => string }> = {
  blob: {
    face: [32, 32],
    draw: (f) =>
      `<path d="M32 6C48 4 58 18 56 34C54 50 42 58 28 56C14 54 6 42 8 28C10 14 20 7 32 6Z" fill="${f}"/>`,
  },
  circle: { face: [32, 32], draw: (f) => `<circle cx="32" cy="32" r="26" fill="${f}"/>` },
  square: {
    face: [32, 32],
    draw: (f) => `<rect x="7" y="7" width="50" height="50" rx="14" fill="${f}"/>`,
  },
  pill: {
    face: [32, 30],
    draw: (f) => `<rect x="14" y="5" width="36" height="54" rx="18" fill="${f}"/>`,
  },
  drop: {
    face: [32, 41],
    draw: (f) =>
      `<path d="M32 5C40 17 54 26 54 40C54 52 44 59 32 59C20 59 10 52 10 40C10 26 24 17 32 5Z" fill="${f}"/>`,
  },
  bell: {
    face: [32, 37],
    draw: (f) => `<path d="M22 8Q32 4 42 8L56 52Q57 58 50 58H14Q7 58 8 52Z" fill="${f}"/>`,
  },
  hexagon: {
    face: [32, 32],
    draw: (f) =>
      `<polygon points="32,7 54,19 54,45 32,57 10,45 10,19" fill="${f}" stroke="${f}" ${ROUNDED}/>`,
  },
  diamond: {
    face: [32, 32],
    draw: (f) =>
      `<rect x="15" y="15" width="34" height="34" rx="5" fill="${f}" stroke="${f}" ${ROUNDED} transform="rotate(45 32 32)"/>`,
  },
};

/** Mixes a hex color toward white (amount > 0) or black (amount < 0), as `shade` does in the app. */
const shade = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const ch = (shift: number) =>
    Math.round(((n >> shift) & 255) * (1 - t) + target * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
};

let counter = 0;
/** The SVG body (64x64 viewBox) of a bot's avatar. Every call gets its own gradient id, so two copies on a page never share one. */
export const artOf = (id: ArtId, color: string) => {
  const shape = SHAPES[id];
  const gradient = `bot-art-${++counter}`;
  const [fx, fy] = shape.face;
  return (
    `<defs><linearGradient id="${gradient}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(color, 0.35)}"/><stop offset="1" stop-color="${shade(color, -0.25)}"/></linearGradient></defs>` +
    shape.draw(`url(#${gradient})`) +
    `<g stroke="#fff" stroke-opacity="0.92" stroke-linecap="round" stroke-width="2.6"><path d="M${fx - 7} ${fy - 3}v3M${fx + 5} ${fy - 3}v3"/><path d="M${fx - 3} ${fy + 5}h5" stroke-width="2"/></g>`
  );
};

/** Every bot the page names, with its shape and color (the app's swatches, see AVATAR_SWATCHES). Writer, Reviewer, Researcher and Editor run the examples; the rest are the app's personality presets. */
export const CAST = {
  writer: { name: "Writer", art: "blob", color: "#dc8a42" },
  reviewer: { name: "Reviewer", art: "hexagon", color: "#4a80e6" },
  researcher: { name: "Researcher", art: "drop", color: "#47a5c4" },
  coach: { name: "Coach", art: "circle", color: "#c8588a" },
  editor: { name: "Editor", art: "bell", color: "#7e5cc4" },
  analyst: { name: "Analyst", art: "diamond", color: "#cfa843" },
  coder: { name: "Coder", art: "square", color: "#46a05f" },
  concierge: { name: "Concierge", art: "pill", color: "#4aa396" },
} as const satisfies Record<string, { name: string; art: ArtId; color: string }>;

export type BotKey = keyof typeof CAST;

/** The shape and color of a bot named on the page ("Writer" -> orange blob). Unknown names fall back to a green circle. */
export const artFor = (name: string): { art: ArtId; color: string } => {
  const bot = Object.values(CAST).find((b) => b.name === name);
  return bot ? { art: bot.art, color: bot.color } : { art: "circle", color: "#46a05f" };
};

/** Vendor marks copied from apps/web/src/features/plugins (the app's plugin catalog). `plate` puts a white tile behind a dark mark, `dark` a dark tile behind a light one. */
export const LOGOS = {
  GitHub: { src: github.src, plate: true },
  Linear: { src: linear.src },
  Notion: { src: notion.src },
  Sentry: { src: sentry.src },
  PostHog: { src: posthog.src },
  Cloudflare: { src: cloudflare.src },
  "Google Calendar": { src: google.src },
  "Google Agenda": { src: google.src },
  Gmail: { src: google.src },
  "Google Drive": { src: google.src },
  Drive: { src: google.src },
  Telegram: { src: telegram.src },
  WhatsApp: { src: whatsapp.src },
  Playwright: { src: playwright.src },
  PostgreSQL: { src: postgresql.src },
  "1Password": { src: onepassword.src },
  Bitwarden: { src: bitwarden.src },
  Context7: { src: context7.src },
  "Chrome DevTools": { src: chromeDevtools.src },
  Pi: { src: pi.src },
  Codex: { src: codex.src },
  OMP: { src: omp.src, dark: true },
  "Claude Code": { src: claudeCode.src },
  OpenCode: { src: opencode.src, plate: true },
  Cursor: { src: cursor.src, plate: true },
} as const satisfies Record<string, { src: string; plate?: boolean; dark?: boolean }>;

export const logoOf = (
  name: string,
): { src: string; plate?: boolean; dark?: boolean } | undefined =>
  (LOGOS as Record<string, { src: string; plate?: boolean; dark?: boolean }>)[name];
