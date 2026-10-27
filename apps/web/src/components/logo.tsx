import svg from "../../public/logo.svg?raw";

/** The project logo, inlined from public/logo.svg so its colors can be themed: set `--logo-ink`, `--logo-face`, `--logo-eye`, `--logo-shade`, `--logo-metal` or `--logo-lens` on the element or an ancestor. The same robot face is the Chief bot's default avatar. */
export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 [&>svg]:size-full ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
