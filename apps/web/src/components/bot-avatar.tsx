import { useId, type ReactNode } from "react";

import { Logo } from "./logo";

import type { AvatarValue } from "@zetta/core/avatar";
export type { AvatarValue };
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
  /** Where the face sits on the 64x64 canvas. */ face: [number, number];
  Draw: (props: { fill: string }) => ReactNode;
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

const star = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 12 : 27,
      a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(32 + r * Math.cos(a)).toFixed(1)},${(35 + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
})();
/** Vertices of a regular polygon on the 64x64 canvas; `radius(i)` lets a caller alternate radii for spiky shapes. */
const polygon = (n: number, radius: (i: number) => number, cy: number, startDeg = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((2 * Math.PI) / n) * i + (startDeg * Math.PI) / 180;
    return `${(32 + radius(i) * Math.cos(a)).toFixed(1)},${(cy + radius(i) * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
const pentagon = polygon(5, () => 26, 33);
const octagon = polygon(8, () => 26, 32, -67.5);
const burst = polygon(16, (i) => (i % 2 ? 22 : 27), 32);
const rounded = { strokeWidth: 5, strokeLinejoin: "round" as const };

function ArrowShape({ fill: f }: { fill: string }) {
  return <path d="M12 9Q14 4 19 7L56 34Q61 38 54 40L38 43L30 57Q27 62 24 56Z" fill={f} />;
}

function BlobShape({ fill: f }: { fill: string }) {
  return (
    <path d="M32 6C48 4 58 18 56 34C54 50 42 58 28 56C14 54 6 42 8 28C10 14 20 7 32 6Z" fill={f} />
  );
}

function CircleShape({ fill: f }: { fill: string }) {
  return <circle cx="32" cy="32" r="26" fill={f} />;
}

function SquareShape({ fill: f }: { fill: string }) {
  return <rect x="7" y="7" width="50" height="50" rx="14" fill={f} />;
}

function PillShape({ fill: f }: { fill: string }) {
  return <rect x="14" y="5" width="36" height="54" rx="18" fill={f} />;
}

function DropShape({ fill: f }: { fill: string }) {
  return (
    <path
      d="M32 5C40 17 54 26 54 40C54 52 44 59 32 59C20 59 10 52 10 40C10 26 24 17 32 5Z"
      fill={f}
    />
  );
}

function BellShape({ fill: f }: { fill: string }) {
  return <path d="M22 8Q32 4 42 8L56 52Q57 58 50 58H14Q7 58 8 52Z" fill={f} />;
}

function HexagonShape({ fill: f }: { fill: string }) {
  return <polygon points="32,7 54,19 54,45 32,57 10,45 10,19" fill={f} stroke={f} {...rounded} />;
}

function DiamondShape({ fill: f }: { fill: string }) {
  return (
    <rect
      x="15"
      y="15"
      width="34"
      height="34"
      rx="5"
      fill={f}
      stroke={f}
      {...rounded}
      transform="rotate(45 32 32)"
    />
  );
}

function StarShape({ fill: f }: { fill: string }) {
  return <polygon points={star} fill={f} stroke={f} {...rounded} />;
}

function TriangleShape({ fill: f }: { fill: string }) {
  return <polygon points="32,9 56,52 8,52" fill={f} stroke={f} {...rounded} />;
}

function PentagonShape({ fill: f }: { fill: string }) {
  return <polygon points={pentagon} fill={f} stroke={f} {...rounded} />;
}

function OctagonShape({ fill: f }: { fill: string }) {
  return <polygon points={octagon} fill={f} stroke={f} {...rounded} />;
}

function CrossShape({ fill: f }: { fill: string }) {
  return (
    <polygon
      points="24,8 40,8 40,24 56,24 56,40 40,40 40,56 24,56 24,40 8,40 8,24 24,24"
      fill={f}
      stroke={f}
      {...rounded}
    />
  );
}

function ArchShape({ fill: f }: { fill: string }) {
  return <path d="M10 57V32A22 22 0 0 1 54 32V57Z" fill={f} stroke={f} {...rounded} />;
}

function ParallelogramShape({ fill: f }: { fill: string }) {
  return <polygon points="20,10 58,10 44,54 6,54" fill={f} stroke={f} {...rounded} />;
}

function KiteShape({ fill: f }: { fill: string }) {
  return <polygon points="32,6 54,28 32,58 10,28" fill={f} stroke={f} {...rounded} />;
}

function BurstShape({ fill: f }: { fill: string }) {
  return <polygon points={burst} fill={f} stroke={f} {...rounded} />;
}

/** Body shapes drawn at the frontend. Each is filled with a gradient of one customizable color and carries a small face. */
export const AVATAR_SHAPES: AvatarShape[] = [
  {
    id: "arrow",
    label: "Arrow",
    layout: "mail",
    face: [30, 29],
    Draw: ArrowShape,
  },
  {
    id: "blob",
    label: "Blob",
    layout: "compact",
    face: [32, 32],
    Draw: BlobShape,
  },
  {
    id: "circle",
    label: "Circle",
    layout: "bubble",
    face: [32, 32],
    Draw: CircleShape,
  },
  {
    id: "square",
    label: "Square",
    layout: "card",
    face: [32, 32],
    Draw: SquareShape,
  },
  {
    id: "pill",
    label: "Pill",
    layout: "terminal",
    face: [32, 30],
    Draw: PillShape,
  },
  {
    id: "drop",
    label: "Drop",
    layout: "poster",
    face: [32, 41],
    Draw: DropShape,
  },
  {
    id: "bell",
    label: "Bell",
    layout: "banner",
    face: [32, 37],
    Draw: BellShape,
  },
  {
    id: "hexagon",
    label: "Hexagon",
    layout: "tile",
    face: [32, 32],
    Draw: HexagonShape,
  },
  {
    id: "diamond",
    label: "Diamond",
    layout: "outline",
    face: [32, 32],
    Draw: DiamondShape,
  },
  {
    id: "star",
    label: "Star",
    layout: "spotlight",
    face: [32, 37],
    Draw: StarShape,
  },
  {
    id: "triangle",
    label: "Triangle",
    layout: "card",
    face: [32, 40],
    Draw: TriangleShape,
  },
  {
    id: "pentagon",
    label: "Pentagon",
    layout: "compact",
    face: [32, 33],
    Draw: PentagonShape,
  },
  {
    id: "octagon",
    label: "Octagon",
    layout: "terminal",
    face: [32, 32],
    Draw: OctagonShape,
  },
  {
    id: "cross",
    label: "Cross",
    layout: "banner",
    face: [32, 32],
    Draw: CrossShape,
  },
  {
    id: "arch",
    label: "Arch",
    layout: "poster",
    face: [32, 38],
    Draw: ArchShape,
  },
  {
    id: "parallelogram",
    label: "Parallelogram",
    layout: "mail",
    face: [32, 32],
    Draw: ParallelogramShape,
  },
  {
    id: "kite",
    label: "Kite",
    layout: "bubble",
    face: [32, 30],
    Draw: KiteShape,
  },
  {
    id: "burst",
    label: "Burst",
    layout: "tile",
    face: [32, 32],
    Draw: BurstShape,
  },
];

export type AvatarCharacter = {
  id: string;
  label: string;
  layout: SidebarLayout;
  colors: [string, string, string];
  colorLabels: [string, string, string];
  Art: (props: { colors: string[] }) => ReactNode;
};
const DARK = "#1b1b1f";

function OrbitArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <circle cx="32" cy="32" r="13" fill={body} />
      <ellipse
        cx="32"
        cy="32"
        rx="25"
        ry="9"
        fill="none"
        stroke={accent}
        strokeWidth="3.5"
        transform="rotate(-28 32 32)"
      />
      <path d="M14 52 50 12" stroke={accent} strokeWidth="3.5" strokeLinecap="round" />
    </>
  );
}

function MouseArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <circle cx="15" cy="17" r="11" fill={body} />
      <circle cx="49" cy="17" r="11" fill={body} />
      <circle cx="15" cy="17" r="6" fill={accent} />
      <circle cx="49" cy="17" r="6" fill={accent} />
      <ellipse cx="32" cy="38" rx="20" ry="18" fill={body} />
      <circle cx="24" cy="34" r="3" fill={inkOn(body)} />
      <circle cx="40" cy="34" r="3" fill={inkOn(body)} />
      <ellipse cx="32" cy="43" rx="3.5" ry="2.8" fill={accent} />
      <path
        d="M10 40h9M10 46l9-3M54 40h-9M54 46l-9-3"
        stroke={DARK}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  );
}

function RobotArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <path d="M32 8v8" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="8" r="3.5" fill={accent} />
      <rect x="10" y="16" width="44" height="36" rx="9" fill={body} />
      <rect x="17" y="26" width="10" height="9" rx="3" fill={accent} />
      <rect x="37" y="26" width="10" height="9" rx="3" fill={accent} />
      <path d="M22 43h20" stroke={bg} strokeWidth="3" strokeLinecap="round" strokeDasharray="4 3" />
    </>
  );
}

function CatArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <path d="M10 28 12 6l16 12zM54 28 52 6 36 18z" fill={body} />
      <circle cx="32" cy="36" r="22" fill={body} />
      <ellipse cx="32" cy="44" rx="10" ry="7" fill={accent} />
      <ellipse cx="23" cy="33" rx="2.5" ry="3.5" fill={inkOn(body)} />
      <ellipse cx="41" cy="33" rx="2.5" ry="3.5" fill={inkOn(body)} />
      <path d="M29 41h6l-3 3z" fill={DARK} />
      <path
        d="M6 36h10M6 42l10-2M58 36H48M58 42l-10-2"
        stroke={DARK}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  );
}

function OwlArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <path d="M12 10 22 18H42L52 10V40C52 50 43 58 32 58S12 50 12 40z" fill={body} />
      <circle cx="23" cy="30" r="9" fill="#fff" />
      <circle cx="41" cy="30" r="9" fill="#fff" />
      <circle cx="23" cy="30" r="4.5" fill={accent} />
      <circle cx="41" cy="30" r="4.5" fill={accent} />
      <circle cx="23" cy="30" r="2" fill={DARK} />
      <circle cx="41" cy="30" r="2" fill={DARK} />
      <path d="M28 38h8l-4 8z" fill={accent} />
    </>
  );
}

function SparkArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <path
        d="M30 8c2 14 8 20 22 22-14 2-20 8-22 22-2-14-8-20-22-22 14-2 20-8 22-22z"
        fill={body}
      />
      <path d="M50 36c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" fill={accent} />
    </>
  );
}

function GhostArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <path
        d="M15 56V30C15 18 22 9 32 9S49 18 49 30V56L43 50L37.5 56L32 50L26.5 56L21 50Z"
        fill={body}
      />
      <ellipse cx="26" cy="29" rx="3" ry="4" fill={inkOn(body)} />
      <ellipse cx="38" cy="29" rx="3" ry="4" fill={inkOn(body)} />
      <circle cx="20.5" cy="37" r="3" fill={accent} />
      <circle cx="43.5" cy="37" r="3" fill={accent} />
      <ellipse cx="32" cy="38" rx="3" ry="4" fill={DARK} />
    </>
  );
}

function RocketArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <circle cx="11" cy="13" r="1.5" fill={body} />
      <circle cx="53" cy="18" r="1.5" fill={body} />
      <circle cx="50" cy="55" r="1.5" fill={body} />
      <path d="M26 46Q32 66 38 46Z" fill={accent} />
      <path d="M25 34 14 50l12-4zM39 34l11 16-12-4z" fill={accent} />
      <path d="M32 5C43 14 45 30 42 47H22C19 30 21 14 32 5z" fill={body} />
      <circle cx="32" cy="26" r="6" fill={bg} stroke={accent} strokeWidth="2.5" />
    </>
  );
}

function FrogArt({ colors: [bg, body, accent] }: { colors: string[] }) {
  return (
    <>
      <rect width="64" height="64" fill={bg} />
      <ellipse cx="32" cy="41" rx="23" ry="17" fill={body} />
      <circle cx="19" cy="23" r="10" fill={body} />
      <circle cx="45" cy="23" r="10" fill={body} />
      <circle cx="19" cy="23" r="6.5" fill="#fff" />
      <circle cx="45" cy="23" r="6.5" fill="#fff" />
      <circle cx="20" cy="24" r="3.2" fill={DARK} />
      <circle cx="44" cy="24" r="3.2" fill={DARK} />
      <circle cx="14" cy="43" r="3.5" fill={accent} />
      <circle cx="50" cy="43" r="3.5" fill={accent} />
      <path
        d="M20 45Q32 54 44 45"
        fill="none"
        stroke={DARK}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M29 36h.1M35 36h.1" stroke={DARK} strokeWidth="2.4" strokeLinecap="round" />
    </>
  );
}

/** Illustrated characters. Each takes three colors (background, body, accent). */
export const AVATAR_CHARACTERS: AvatarCharacter[] = [
  {
    id: "orbit",
    label: "Orbit",
    layout: "ring",
    colors: ["#0b0b0f", "#f4f4f5", "#7c7cff"],
    colorLabels: ["Background", "Planet", "Slash"],
    Art: OrbitArt,
  },
  {
    id: "mouse",
    label: "Mouse",
    layout: "cozy",
    colors: ["#fde68a", "#9ca3af", "#f9a8d4"],
    colorLabels: ["Background", "Fur", "Ears & nose"],
    Art: MouseArt,
  },
  {
    id: "robot",
    label: "Robot",
    layout: "console",
    colors: ["#0f172a", "#94a3b8", "#22d3ee"],
    colorLabels: ["Background", "Casing", "Eyes & antenna"],
    Art: RobotArt,
  },
  {
    id: "cat",
    label: "Cat",
    layout: "sticker",
    colors: ["#c7d2fe", "#f59e0b", "#fef3c7"],
    colorLabels: ["Background", "Fur", "Muzzle"],
    Art: CatArt,
  },
  {
    id: "owl",
    label: "Owl",
    layout: "ribbon",
    colors: ["#134e4a", "#a16207", "#fde047"],
    colorLabels: ["Background", "Feathers", "Beak & pupils"],
    Art: OwlArt,
  },
  {
    id: "spark",
    label: "Spark",
    layout: "glass",
    colors: ["#312e81", "#fbbf24", "#f472b6"],
    colorLabels: ["Background", "Big star", "Small star"],
    Art: SparkArt,
  },
  {
    id: "ghost",
    label: "Ghost",
    layout: "spotlight",
    colors: ["#1e1b4b", "#e0e7ff", "#f9a8d4"],
    colorLabels: ["Background", "Body", "Cheeks"],
    Art: GhostArt,
  },
  {
    id: "rocket",
    label: "Rocket",
    layout: "outline",
    colors: ["#0c1a3a", "#e5e7eb", "#f97316"],
    colorLabels: ["Background", "Hull", "Fins & flame"],
    Art: RocketArt,
  },
  {
    id: "frog",
    label: "Frog",
    layout: "bubble",
    colors: ["#fef9c3", "#4ade80", "#fb7185"],
    colorLabels: ["Background", "Skin", "Cheeks"],
    Art: FrogArt,
  },
];

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

const hash = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};
/**
 * The face every shape wears, on the 64x64 canvas: two rounded-square eyes (the Grok Bot face), the same proportions as the
 * generated avatar below (10% wide, 16% tall, centres 26% apart). `spread` is half the distance between the centres.
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
  const gradient = useId();
  const a = bot.avatar;
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
  const shape = a?.kind === "preset" ? shapeOf(a.preset) : undefined;
  if (a?.kind === "preset" && shape) {
    const base = a.colors[0] ?? AVATAR_SWATCHES[0]!,
      [fx, fy] = shape.face,
      ink = eyeInk(base, shape.face);
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className={`shrink-0 overflow-visible drop-shadow-sm ${className}`}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={shade(base, 0.35)} />
            <stop offset="1" stopColor={shade(base, -0.25)} />
          </linearGradient>
        </defs>
        <shape.Draw fill={`url(#${gradient})`} />
        {[-1, 1].map((side) => (
          <rect
            key={side}
            x={fx + side * EYE.spread - EYE.w / 2}
            y={fy - EYE.h / 2}
            width={EYE.w}
            height={EYE.h}
            rx={EYE.r}
            fill={ink}
            fillOpacity="0.8"
          />
        ))}
      </svg>
    );
  }
  if (!a && bot.kind === "chief")
    return <Logo size={size} className={className} tile square={square} />;
  const character = a?.kind === "preset" ? characterOf(a.preset) : undefined;
  if (a?.kind === "preset" && character) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className={`shrink-0 shadow-sm ${className}`}
        style={{ borderRadius: square ? "22%" : "50%" }}
      >
        <character.Art colors={character.colors.map((d, i) => a.colors[i] ?? d)} />
      </svg>
    );
  }
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
