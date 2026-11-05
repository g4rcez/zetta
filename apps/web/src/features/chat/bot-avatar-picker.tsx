import { AvatarPicker } from "@/components/avatar-picker";
import type { AvatarValue } from "@/components/bot-avatar";

/** The picture choices for a bot. The chief's "no picture" is the Zetta logo. */
export function BotAvatarPicker({
  botId,
  kind,
  value,
  onChange,
}: {
  botId: string;
  kind?: "chief" | "specialist";
  value: AvatarValue | null | undefined;
  onChange: (v: AvatarValue | null) => void;
}) {
  return (
    <AvatarPicker
      id={botId}
      kind={kind}
      value={value}
      onChange={onChange}
      none={kind === "chief" ? { label: "Zetta logo", title: "Zetta logo" } : undefined}
    />
  );
}
