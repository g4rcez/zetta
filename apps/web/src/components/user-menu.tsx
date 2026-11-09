import { ActionHint } from "@/components/action-hint";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, MENU_DANGER, Menu, MenuGroup, MenuItem, MenuSeparator } from "@/components/ui";
import { Skeleton } from "@g4rcez/components";
import { CaretUpDownIcon, SlidersHorizontalIcon, UserIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "@/lib/notify";

import { usePreferences } from "@/features/preferences/preferences";
import { useProfile } from "@/features/preferences/profile-api";
import { TIME_FORMAT_LABEL, TIME_FORMATS } from "@/features/preferences/time-format";
import { UserAvatar } from "@/components/user-avatar";
import { railRow, railRowExpanded } from "@/components/rail-row";
import { authClient } from "@/lib/auth-client";
import { AuthenticationRequestError } from "@/lib/auth-transport";

export default function UserMenu({
  compact = false,
  inline = false,
  rail,
}: {
  compact?: boolean;
  inline?: boolean;
  rail?: "collapsed" | "expanded";
}) {
  const navigate = useNavigate();
  const { preferences, set } = usePreferences();
  const { data: session, isPending } = authClient.useSession();
  const { data: profile } = useProfile(Boolean(session));
  const [signingOut, setSigningOut] = useState(false);
  const signOutPending = useRef(false);

  async function signOut() {
    if (signOutPending.current) return;
    signOutPending.current = true;
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new AuthenticationRequestError("unavailable");
      await navigate({ to: "/" });
    } catch {
      // no-excuse-ok: catch -- report only a fixed message at the user action boundary.
      toast.error("Could not confirm sign out. Check your connection, then try again.");
    } finally {
      signOutPending.current = false;
      setSigningOut(false);
    }
  }

  if (isPending) {
    return <Skeleton as="div" decorative className={inline ? "h-8! w-20!" : "size-8! sm:w-24!"} />;
  }

  if (!session) {
    return (
      <Link to="/login">
        {inline ? (
          <span className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-accent">
            Sign In
          </span>
        ) : (
          <Button variant="outline">Sign In</Button>
        )}
      </Link>
    );
  }

  // With visible text the name starts with it (WCAG 2.5.3); icon-only forms keep a label.
  const label = rail === "expanded" || inline ? undefined : `Account menu for ${session.user.name}`;
  const trigger = rail ? (
    <ActionHint label={label}>
      <button
        type="button"
        aria-label={label}
        className={`${railRow} ${rail === "expanded" ? `${railRowExpanded} h-10` : ""}`}
      >
        <UserAvatar name={session.user.name} avatar={profile?.avatar} size={20} />
        {rail === "expanded" ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate text-sm font-medium text-foreground">
                {session.user.name}
              </span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {session.user.email}
              </span>
            </span>
            <span className="sr-only">, account menu</span>
            <CaretUpDownIcon aria-hidden="true" className="size-4 shrink-0" />
          </>
        ) : null}
      </button>
    </ActionHint>
  ) : inline ? (
    // No hint: it shows the user's name.
    <button
      type="button"
      aria-label={label}
      className="flex h-8 max-w-48 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <UserAvatar name={session.user.name} avatar={profile?.avatar} size={24} />
      <span className="hidden min-w-0 truncate sm:block">{session.user.name}</span>
      <span className="sr-only">, account menu</span>
    </button>
  ) : compact ? (
    <ActionHint label={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        className="size-10 rounded-full bg-secondary text-sm font-semibold"
      >
        <UserAvatar name={session.user.name} avatar={profile?.avatar} size={32} />
      </Button>
    </ActionHint>
  ) : (
    // No hint: it shows the user's name.
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      className="sm:w-auto sm:max-w-40 sm:px-2.5"
    >
      <UserIcon aria-hidden="true" className="sm:hidden" />
      <span className="hidden min-w-0 truncate sm:block">{session.user.name}</span>
    </Button>
  );

  return (
    // The menu opens below its trigger and flips above it where the rail sits at the bottom of the screen.
    <Menu
      asChild
      hover={false}
      restoreFocus
      title=""
      floatingClassName="w-64 max-w-[calc(100vw-1rem)]"
      label={trigger}
    >
      <div className="w-full px-2.5 py-1.5">
        <p className="text-sm font-medium break-words">{session.user.name}</p>
        <p className="text-xs break-all text-muted-foreground">{session.user.email}</p>
      </div>
      <MenuSeparator />
      <MenuItem title="Preferences" onClick={() => void navigate({ to: "/preferences" })}>
        <SlidersHorizontalIcon />
        Preferences
      </MenuItem>
      <MenuSeparator />
      <MenuGroup label="Time format">
        {TIME_FORMATS.map((f) => (
          <MenuItem
            key={f}
            title={TIME_FORMAT_LABEL[f]}
            role="menuitemradio"
            checked={f === preferences.timeFormat}
            onClick={() => set({ timeFormat: f })}
          >
            {TIME_FORMAT_LABEL[f]}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem
        title="Sign Out"
        className={MENU_DANGER}
        disabled={signingOut}
        onClick={() => void signOut()}
      >
        {signingOut ? "Signing out…" : "Sign Out"}
      </MenuItem>
    </Menu>
  );
}
