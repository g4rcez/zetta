import type { ReactNode } from "react";

import { Logo } from "./logo";

import type { AvatarValue } from "@zetta/core/avatar";
import { characterOf, presetAvatarUrl } from "@zetta/core/avatar-art";

export type { AvatarValue };
export type { AvatarCharacter, AvatarShape, SidebarLayout } from "@zetta/core/avatar-art";
/** The preset catalog and its helpers live in core (they also draw the SVG files the server serves); the picker and templates read them from here. */
export {
  AVATAR_CHARACTERS,
  AVATAR_SHAPES,
  AVATAR_SWATCHES,
  avatarColor,
  characterOf,
  eyeInk,
  inkOn,
  layoutOf,
  shade,
  shapeOf,
} from "@zetta/core/avatar-art";

const hash = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};
const SHAPES = [
  "50% 50% 50% 50% / 60% 60% 40% 40%",
  "42% 58% 55% 45% / 50% 45% 55% 50%",
  "30% 70% 40% 60% / 55% 40% 60% 45%",
  "50%",
  "35%",
];

/** The bot's picture, with an optional `badge` (for example `BotStatusDot`) pinned to its bottom-right corner. */
export function BotAvatar({
  badge,
  ...props
}: {
  bot: { id: string; avatar?: AvatarValue | null; kind?: "chief" | "specialist" };
  size?: number;
  className?: string;
  square?: boolean;
  badge?: ReactNode;
}) {
  if (!badge) return <BotPicture {...props} />;
  return (
    <span className="relative inline-flex shrink-0">
      <BotPicture {...props} />
      <span className="absolute -right-0.5 -bottom-0.5 flex">{badge}</span>
    </span>
  );
}

/** The bot's picture: its chosen shape + color or uploaded image, else a friendly deterministic generated one. */
function BotPicture({
  bot,
  size = 40,
  className = "",
  square = false,
}: {
  bot: { id: string; avatar?: AvatarValue | null; kind?: "chief" | "specialist" };
  size?: number;
  className?: string;
  square?: boolean;
}) {
  const a = bot.avatar;
  // No zoom: a decorative avatar (alt="") that sits inside links and buttons.
  if (a?.kind === "image")
    return (
      <img
        alt=""
        aria-hidden="true"
        src={a.src}
        width={size}
        height={size}
        className={`shrink-0 object-cover shadow-sm ${className}`}
        style={{ width: size, height: size, borderRadius: square ? "22%" : "50%" }}
      />
    );
  if (a?.kind === "preset") {
    // A shape or a character is a small SVG file the server draws from a template, so a list of bots carries a URL and the browser
    // caches the picture. Characters sit on their own background, so they are clipped; shapes keep their outline and a soft shadow.
    const src = presetAvatarUrl(a.preset, a.colors);
    const character = characterOf(a.preset);
    if (src)
      return (
        <img
          alt=""
          aria-hidden="true"
          src={src}
          width={size}
          height={size}
          decoding="async"
          draggable={false}
          className={`shrink-0 ${character ? "shadow-sm" : "drop-shadow-sm"} ${className}`}
          style={character ? { borderRadius: square ? "22%" : "50%" } : undefined}
        />
      );
  }
  if (!a && bot.kind === "chief")
    return <Logo size={size} className={className} tile square={square} />;
  const h = hash(bot.id),
    hue = h % 360;
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center shadow-sm ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: SHAPES[h % SHAPES.length],
        background: `linear-gradient(135deg, oklch(0.78 0.14 ${hue}), oklch(0.6 0.18 ${(hue + 40) % 360}))`,
      }}
    >
      <span className="flex" style={{ gap: size * 0.16 }}>
        <i
          className="block bg-black/70"
          style={{ width: size * 0.1, height: size * 0.16, borderRadius: size * 0.04 }}
        />
        <i
          className="block bg-black/70"
          style={{ width: size * 0.1, height: size * 0.16, borderRadius: size * 0.04 }}
        />
      </span>
    </span>
  );
}
