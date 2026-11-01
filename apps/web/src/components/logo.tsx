import svg from "../assets/logo.svg?raw";

/**
 * The project logo, inlined from src/assets/logo.svg so its colors can be themed: set `--logo-ink`, `--logo-face`, `--logo-eye`,
 * `--logo-shade`, `--logo-metal` or `--logo-lens` on the element or an ancestor. The same robot face is the chief's default
 * avatar (the chief is "Zetta" by default).
 *
 * With `tile`, the robot keeps the logo's own contrast on any ground: on a light theme its light face would vanish, so it sits
 * at 80% on a tile of the logo's ink; on a dark theme the face already stands out, so the tile is clear and the robot fills it.
 */
export function Logo({
  size = 36,
  className = "",
  tile = false,
  square = true,
}: {
  size?: number;
  className?: string;
  tile?: boolean;
  /** Tile corners: rounded square (bots, the app mark) or a circle. */
  square?: boolean;
}) {
  const art = (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 [&>svg]:size-full ${
        tile ? "size-[80%] dark:size-full" : className
      }`}
      style={tile ? undefined : { width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
  if (!tile) return art;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-[var(--logo-ink,#2b3440)] shadow-sm dark:bg-transparent dark:shadow-none ${className}`}
      style={{ width: size, height: size, borderRadius: square ? "22%" : "50%" }}
    >
      {art}
    </span>
  );
}
