import { CpuIcon, FlaskIcon, LightningIcon, TerminalWindowIcon } from "@phosphor-icons/react";

const RAYS = Array.from({ length: 12 }, (_, i) => i * 30);
// A simplified burst of rays, in the orange of the Claude mark.
function ClaudeMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      {RAYS.map((deg, i) => (
        <rect
          key={deg}
          x="10.9"
          y={i % 2 ? 3 : 1.5}
          width="2.2"
          height={i % 2 ? 6.5 : 8}
          rx="1.1"
          fill="#d97757"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  );
}

// A simplified six-petal knot, the shape the OpenAI mark is built from.
function OpenAiMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="shrink-0"
    >
      {[0, 60, 120].map((deg) => (
        <rect
          key={deg}
          x="8.2"
          y="1.8"
          width="7.6"
          height="13"
          rx="3.8"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      {[0, 60, 120].map((deg) => (
        <rect
          key={`b${deg}`}
          x="8.2"
          y="9.2"
          width="7.6"
          height="13"
          rx="3.8"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  );
}

/** The mark of the company or tool behind an engine, so people pick by the name they know. Decorative: the engine's name sits beside it. */
export function EngineLogo({ harness, size = 20 }: { harness: string; size?: number }) {
  if (harness === "claude-code") return <ClaudeMark size={size} />;
  if (harness === "codex") return <OpenAiMark size={size} />;
  const className = "shrink-0 text-muted-foreground";
  if (harness === "decision")
    return <LightningIcon size={size} className={className} aria-hidden="true" />;
  if (harness === "fixture")
    return <FlaskIcon size={size} className={className} aria-hidden="true" />;
  if (
    harness === "hermes" ||
    harness === "deepseek" ||
    harness === "opencode" ||
    harness === "pi" ||
    harness === "omp" ||
    harness === "cursor"
  )
    return <TerminalWindowIcon size={size} className={className} aria-hidden="true" />;
  return <CpuIcon size={size} className={className} aria-hidden="true" />;
}
