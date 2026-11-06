import { encode } from "uqr";

const QUIET_ZONE = 4;

/** A QR code drawn as SVG paths. Always black on white with a quiet zone, in any theme, so every phone camera can read it. */
export function QrCode({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const { data } = encode(text, { ecc: "M", border: 0 });
  const size = data.length + QUIET_ZONE * 2;
  const modules = data
    .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={size} height={size} fill="#fff" />
      <path d={modules} fill="#000" />
    </svg>
  );
}
