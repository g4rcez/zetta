const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const SHAPES = ["50% 50% 50% 50% / 60% 60% 40% 40%", "42% 58% 55% 45% / 50% 45% 55% 50%", "30% 70% 40% 60% / 55% 40% 60% 45%", "50%", "35%"];

/** A friendly, deterministic avatar per bot: a soft colored shape with two eyes. */
export function BotAvatar({ id, size = 40, className = "" }: { id: string; size?: number; className?: string }) {
  const h = hash(id), hue = h % 360;
  return (
    <span aria-hidden="true" className={`relative inline-flex shrink-0 items-center justify-center shadow-sm ${className}`}
      style={{ width: size, height: size, borderRadius: SHAPES[h % SHAPES.length], background: `linear-gradient(135deg, oklch(0.78 0.14 ${hue}), oklch(0.6 0.18 ${(hue + 40) % 360}))` }}>
      <span className="flex gap-[18%]" style={{ gap: size * 0.16 }}>
        <i className="block rounded-full bg-black/70" style={{ width: size * 0.1, height: size * 0.16 }} />
        <i className="block rounded-full bg-black/70" style={{ width: size * 0.1, height: size * 0.16 }} />
      </span>
    </span>
  );
}
