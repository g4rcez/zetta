import { Checkbox } from "@/components/ui";
import { BotIdentity } from "@/components/bot-identity";
import type { Bot } from "../chat/chat-client";

/** Which of the person's bots bring a skill to their harness. Each bot is drawn with its identity, never as plain text. */
export function BotPicker({
  bots,
  selected,
  onChange,
}: {
  bots: Bot[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!bots.length)
    return <p className="text-sm text-muted-foreground">You have no bots to attach it to yet.</p>;
  return (
    <ul aria-label="Bots" className="grid gap-1 sm:grid-cols-2">
      {bots.map((b) => (
        <li key={b.id}>
          <Checkbox
            aria-label={b.name}
            checked={selected.includes(b.id)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...selected, b.id] : selected.filter((id) => id !== b.id),
              )
            }
          >
            <BotIdentity bot={b} size={24} />
          </Checkbox>
        </li>
      ))}
    </ul>
  );
}
