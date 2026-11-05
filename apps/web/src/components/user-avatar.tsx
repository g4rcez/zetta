import { parseAvatar } from "@zetta/core/avatar";

import { BotAvatar } from "@/components/bot-avatar";

/** A person's picture: their chosen preset or photo, else the first letter of their name. Never a generated blob. */
export function UserAvatar({
  name,
  avatar,
  size = 24,
  className = "",
}: {
  name: string;
  avatar?: unknown;
  size?: number;
  className?: string;
}) {
  const value = parseAvatar(avatar);
  if (value)
    return <BotAvatar bot={{ id: name, avatar: value }} size={size} className={className} />;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground ${size >= 36 ? "text-sm" : "text-xs"} ${className}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
