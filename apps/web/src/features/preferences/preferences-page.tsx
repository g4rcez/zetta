import { SlidersHorizontalIcon } from "@phosphor-icons/react";

import { ApprovalsSection } from "./approvals-section";
import { DisplaySection } from "./display-section";
import { ProfileSection } from "./profile-section";
import { SecuritySection } from "./security-section";
import { SessionsSection } from "./sessions-section";

/** The signed-in person's own profile, password, display choices and sessions, in one scrolling page. */
export function PreferencesPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <SlidersHorizontalIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl text-balance">Preferences</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Manage your own profile and how Zetta looks for you.
            </p>
          </div>
        </header>
        <ProfileSection />
        <SecuritySection />
        <DisplaySection />
        <ApprovalsSection />
        <SessionsSection />
      </div>
    </div>
  );
}
