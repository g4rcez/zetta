import { useState } from "react";
import { parseAvatar } from "@zetta/core/avatar";

import { BotAvatar } from "@/components/bot-avatar";

/** A person's picture: their chosen preset or photo, else their account image, else the first letter of their name. Never a generated blob. */
export function UserAvatar({
  name,
  avatar,
  image,
  size = 24,
  className = "",
}: {
  name: string;
  avatar?: unknown;
  /** The image of the account (for example from the sign-in provider). It comes after the chosen avatar and falls back to the letter if it fails to load. */
  image?: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const value = parseAvatar(avatar);
  if (value)
    return <BotAvatar bot={{ id: name, avatar: value }} size={size} className={className} />;
  // No zoom: a decorative avatar (alt="") that sits inside links and buttons.
  if (image && !failed)
    return (
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
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
