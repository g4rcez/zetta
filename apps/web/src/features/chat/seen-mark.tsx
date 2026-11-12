import { CheckIcon } from "@phosphor-icons/react";
import { useContext } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { BotsContext } from "@/components/bot-identity";
import { IconHint } from "@/components/icon-hint";

const MAX_FACES = 4;

/** "Read by Dev", "Read by Dev and Ana", "Read by Dev, Ana and 2 more". */
export function readBy(names: readonly string[]): string {
  if (names.length <= 1) return `Read by ${names[0] ?? "a bot"}`;
  if (names.length === 2) return `Read by ${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `Read by ${names[0]}, ${names[1]} and ${rest} more`;
}

/**
 * Under a person's message: a check and the faces of the bots that picked it up (a bot has picked a message up when its reply or its
 * turn started). Nothing shows until a bot has, so a message nobody read yet carries no mark. Hover, focus or tap names them.
 */
export function SeenMark({ botIds }: { botIds: readonly string[] }) {
  const bots = useContext(BotsContext);
  if (!botIds.length) return null;
  const known = botIds.map((id) => bots.get(id) ?? { id, name: "A bot" });
  const extra = known.length - MAX_FACES;
  return (
    <span className="flex w-fit">
      <IconHint label={readBy(known.map((b) => b.name))}>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CheckIcon aria-hidden="true" weight="bold" className="size-3" />
          <span className="flex -space-x-1">
            {known.slice(0, MAX_FACES).map((b) => (
              <BotAvatar key={b.id} bot={b} size={14} className="ring-1 ring-background" />
            ))}
          </span>
          {extra > 0 && <span className="text-[10px] tabular-nums">+{extra}</span>}
        </span>
      </IconHint>
    </span>
  );
}
