// The page's illustrations are the product's own bot art: these characters are ported from
// apps/web/src/components/bot-avatar.tsx (AVATAR_CHARACTERS, same shapes and default colors).
// DESIGN.md exempts avatar art from the token and gradient rules, so the colors here are the art's own.
// Change the art in the app first, then here.
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

const DARK = "#1b1b1f";

export type ArtId =
  | "owl"
  | "cat"
  | "rocket"
  | "frog"
  | "ghost"
  | "spark"
  | "robot"
  | "mouse"
  | "orbit";

const ART: Record<
  ArtId,
  { colors: [string, string, string]; draw: (c: [string, string, string]) => string }
> = {
  orbit: {
    colors: ["#0b0b0f", "#f4f4f5", "#7c7cff"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><circle cx="32" cy="32" r="13" fill="${body}"/><ellipse cx="32" cy="32" rx="25" ry="9" fill="none" stroke="${accent}" stroke-width="3.5" transform="rotate(-28 32 32)"/><path d="M14 52 50 12" stroke="${accent}" stroke-width="3.5" stroke-linecap="round"/>`,
  },
  mouse: {
    colors: ["#fde68a", "#9ca3af", "#f9a8d4"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><circle cx="15" cy="17" r="11" fill="${body}"/><circle cx="49" cy="17" r="11" fill="${body}"/><circle cx="15" cy="17" r="6" fill="${accent}"/><circle cx="49" cy="17" r="6" fill="${accent}"/><ellipse cx="32" cy="38" rx="20" ry="18" fill="${body}"/><circle cx="24" cy="34" r="3" fill="${DARK}"/><circle cx="40" cy="34" r="3" fill="${DARK}"/><ellipse cx="32" cy="43" rx="3.5" ry="2.8" fill="${accent}"/><path d="M10 40h9M10 46l9-3M54 40h-9M54 46l-9-3" stroke="${DARK}" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  robot: {
    colors: ["#0f172a", "#94a3b8", "#22d3ee"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><path d="M32 8v8" stroke="${accent}" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="8" r="3.5" fill="${accent}"/><rect x="10" y="16" width="44" height="36" rx="9" fill="${body}"/><rect x="17" y="26" width="10" height="9" rx="3" fill="${accent}"/><rect x="37" y="26" width="10" height="9" rx="3" fill="${accent}"/><path d="M22 43h20" stroke="${bg}" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"/>`,
  },
  cat: {
    colors: ["#c7d2fe", "#f59e0b", "#fef3c7"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><path d="M10 28 12 6l16 12zM54 28 52 6 36 18z" fill="${body}"/><circle cx="32" cy="36" r="22" fill="${body}"/><ellipse cx="32" cy="44" rx="10" ry="7" fill="${accent}"/><ellipse cx="23" cy="33" rx="2.5" ry="3.5" fill="${DARK}"/><ellipse cx="41" cy="33" rx="2.5" ry="3.5" fill="${DARK}"/><path d="M29 41h6l-3 3z" fill="${DARK}"/><path d="M6 36h10M6 42l10-2M58 36H48M58 42l-10-2" stroke="${DARK}" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  owl: {
    colors: ["#134e4a", "#a16207", "#fde047"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><path d="M12 10 22 18H42L52 10V40C52 50 43 58 32 58S12 50 12 40z" fill="${body}"/><circle cx="23" cy="30" r="9" fill="#fff"/><circle cx="41" cy="30" r="9" fill="#fff"/><circle cx="23" cy="30" r="4.5" fill="${accent}"/><circle cx="41" cy="30" r="4.5" fill="${accent}"/><circle cx="23" cy="30" r="2" fill="${DARK}"/><circle cx="41" cy="30" r="2" fill="${DARK}"/><path d="M28 38h8l-4 8z" fill="${accent}"/>`,
  },
  spark: {
    colors: ["#312e81", "#fbbf24", "#f472b6"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><path d="M30 8c2 14 8 20 22 22-14 2-20 8-22 22-2-14-8-20-22-22 14-2 20-8 22-22z" fill="${body}"/><path d="M50 36c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" fill="${accent}"/>`,
  },
  ghost: {
    colors: ["#1e1b4b", "#e0e7ff", "#f9a8d4"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><path d="M15 56V30C15 18 22 9 32 9S49 18 49 30V56L43 50L37.5 56L32 50L26.5 56L21 50Z" fill="${body}"/><ellipse cx="26" cy="29" rx="3" ry="4" fill="${DARK}"/><ellipse cx="38" cy="29" rx="3" ry="4" fill="${DARK}"/><circle cx="20.5" cy="37" r="3" fill="${accent}"/><circle cx="43.5" cy="37" r="3" fill="${accent}"/><ellipse cx="32" cy="38" rx="3" ry="4" fill="${DARK}"/>`,
  },
  rocket: {
    colors: ["#0c1a3a", "#e5e7eb", "#f97316"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><circle cx="11" cy="13" r="1.5" fill="${body}"/><circle cx="53" cy="18" r="1.5" fill="${body}"/><circle cx="50" cy="55" r="1.5" fill="${body}"/><path d="M26 46Q32 66 38 46Z" fill="${accent}"/><path d="M25 34 14 50l12-4zM39 34l11 16-12-4z" fill="${accent}"/><path d="M32 5C43 14 45 30 42 47H22C19 30 21 14 32 5z" fill="${body}"/><circle cx="32" cy="26" r="6" fill="${bg}" stroke="${accent}" stroke-width="2.5"/>`,
  },
  frog: {
    colors: ["#fef9c3", "#4ade80", "#fb7185"],
    draw: ([bg, body, accent]) =>
      `<rect width="64" height="64" fill="${bg}"/><ellipse cx="32" cy="41" rx="23" ry="17" fill="${body}"/><circle cx="19" cy="23" r="10" fill="${body}"/><circle cx="45" cy="23" r="10" fill="${body}"/><circle cx="19" cy="23" r="6.5" fill="#fff"/><circle cx="45" cy="23" r="6.5" fill="#fff"/><circle cx="20" cy="24" r="3.2" fill="${DARK}"/><circle cx="44" cy="24" r="3.2" fill="${DARK}"/><circle cx="14" cy="43" r="3.5" fill="${accent}"/><circle cx="50" cy="43" r="3.5" fill="${accent}"/><path d="M20 45Q32 54 44 45" fill="none" stroke="${DARK}" stroke-width="2.2" stroke-linecap="round"/><path d="M29 36h.1M35 36h.1" stroke="${DARK}" stroke-width="2.4" stroke-linecap="round"/>`,
  },
};

/** The SVG body (64x64 viewBox) of a character in its default colors. */
export const artOf = (id: ArtId) => ART[id].draw(ART[id].colors);

/** Every bot the page names, with its character. Writer, Reviewer and Researcher run the examples; the rest are the app's personality presets. */
export const CAST = {
  writer: { name: "Writer", art: "cat" },
  reviewer: { name: "Reviewer", art: "owl" },
  researcher: { name: "Researcher", art: "rocket" },
  coach: { name: "Coach", art: "frog" },
  editor: { name: "Editor", art: "ghost" },
  analyst: { name: "Analyst", art: "spark" },
  coder: { name: "Coder", art: "robot" },
  concierge: { name: "Concierge", art: "mouse" },
} as const satisfies Record<string, { name: string; art: ArtId }>;

export type BotKey = keyof typeof CAST;

/** The character of a bot named on the page ("Writer" -> cat). Unknown names fall back to the robot. */
export const artFor = (name: string): ArtId =>
  (Object.values(CAST).find((b) => b.name === name)?.art as ArtId | undefined) ?? "robot";

/** Vendor marks copied from apps/web/src/features/plugins (the app's plugin catalog). `plate` puts a white tile behind a dark mark. */
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
} as const satisfies Record<string, { src: string; plate?: boolean }>;

export const logoOf = (name: string): { src: string; plate?: boolean } | undefined =>
  (LOGOS as Record<string, { src: string; plate?: boolean }>)[name];
