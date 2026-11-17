import { ListChecksIcon } from "@phosphor-icons/react";

import { ActionHint } from "@/components/action-hint";
import { BotIdentity } from "@/components/bot-identity";
import { Checkbox, Dropdown } from "@/components/ui";
import { useSidebarPins } from "./sidebar-pin-actions";

/**
 * "Choose bots": a checklist of every bot the person can see. A ticked bot is in the sidebar; unticking takes it out (it stays in "All
 * bots"). It writes the same preference as the pin button on the Bots page (`sidebarBots`). The chief is always in the sidebar, so it is
 * not listed. The list follows the sidebar's order, then the bots that are out of it. "Automatic" clears the choice and the sidebar picks by itself again.
 */
export function SidebarBotChooser({ botId }: { botId: string | undefined }) {
  const { inSidebar, ordered: choices, pinned, setPinned, reset } = useSidebarPins(botId);
  return (
    <Dropdown
      asChild
      hover={false}
      align="start"
      aria-label="Choose the bots in the sidebar"
      trigger={
        <ActionHint label="Choose bots">
          <button
            type="button"
            aria-label="Choose bots"
            className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-open:text-foreground"
          >
            <ListChecksIcon aria-hidden="true" className="size-4" />
          </button>
        </ActionHint>
      }
    >
      <div className="w-60 max-w-[calc(100vw-4rem)] text-sm">
        <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Bots in the sidebar</p>
        {choices.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">You have no other bots yet.</p>
        ) : (
          <ul aria-label="Bots in the sidebar" className="max-h-72 space-y-px overflow-y-auto">
            {choices.map((b) => (
              <li key={b.id}>
                <Checkbox
                  aria-label={b.name}
                  checked={inSidebar.has(b.id)}
                  onChange={(e) => setPinned(b.id, e.target.checked)}
                >
                  <BotIdentity bot={b} size={20} />
                </Checkbox>
              </li>
            ))}
          </ul>
        )}
        {pinned && (
          <button
            type="button"
            onClick={reset}
            className="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Automatic: let the sidebar pick
          </button>
        )}
      </div>
    </Dropdown>
  );
}
