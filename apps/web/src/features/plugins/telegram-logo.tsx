import { useId } from "react";

/** Telegram brand colours: logo gradient (#2AABEE to #229ED9) and the blue used for actions. Keep the logo unaltered, per Telegram's brand rules. */
export const TELEGRAM = { light: "#2AABEE", base: "#229ED9", deep: "#1C8BC0" } as const;

/** The Telegram logo: the paper plane on the blue gradient circle. */
export function TelegramLogo({ className = "size-5" }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <defs><linearGradient id={id} x1="12" y1="0" x2="12" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor={TELEGRAM.light} /><stop offset="1" stopColor={TELEGRAM.base} /></linearGradient></defs>
      <circle cx="12" cy="12" r="12" fill={`url(#${id})`} />
      <path fill="#fff" d="M16.906 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
