import { Radiobox } from "@/components/ui";
import { DEFAULT_APPROVAL_MODE, usePreferences, type ApprovalMode } from "./preferences";
import { Section } from "./section";

const CHOICES: { mode: ApprovalMode; label: string; help: string }[] = [
  {
    mode: "hold",
    label: "Press and hold",
    help: "Hold the button for a moment. A slip of the finger cannot approve it.",
  },
  { mode: "click", label: "Just click", help: "One click approves." },
];

/**
 * How a card that widens what a bot may do is approved (a permission, a new bot, a command that needs your word). Cards that only ask for a
 * click stay a click either way. Saved on the account, so it follows the person to any device.
 */
export function ApprovalsSection() {
  const { preferences, set } = usePreferences();
  // An older answer from the server may not carry the field yet.
  const mode = preferences.approvalMode ?? DEFAULT_APPROVAL_MODE;
  return (
    <Section id="approvals" title="Approvals" description="How you confirm what a bot asks to do.">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Confirm an approval by</legend>
        <div className="space-y-3">
          {CHOICES.map((c) => (
            <div key={c.mode}>
              <Radiobox
                name="approval-mode"
                checked={mode === c.mode}
                onChange={() => set({ approvalMode: c.mode })}
              >
                {c.label}
                {c.mode === DEFAULT_APPROVAL_MODE ? " (default)" : ""}
              </Radiobox>
              <p className="ml-7 text-xs text-muted-foreground">{c.help}</p>
            </div>
          ))}
        </div>
      </fieldset>
    </Section>
  );
}
