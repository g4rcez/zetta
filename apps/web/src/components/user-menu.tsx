import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { Menu, MenuItem } from "@g4rcez/components/menu";
import { Skeleton } from "@zetta/ui/components/skeleton";
import { CaretUpDownIcon, SlidersHorizontalIcon, UserIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { usePreferences } from "@/features/preferences/preferences";
import { useProfile } from "@/features/preferences/profile-api";
import {
  TIME_FORMAT_LABEL,
  TIME_FORMATS,
  type TimeFormat,
} from "@/features/preferences/time-format";
import { UserAvatar } from "@/components/user-avatar";
import { MENU_ITEM_DESTRUCTIVE, MenuGroup, MenuSeparator } from "@/components/menu-parts";
import { railRow, railRowExpanded } from "@/components/rail-row";
import { authClient } from "@/lib/auth-client";
import { AuthenticationRequestError } from "@/lib/auth-transport";

export default function UserMenu({
  compact = false,
  inline = false,
  rail,
  drawer = false,
}: {
  compact?: boolean;
  inline?: boolean;
  rail?: "collapsed" | "expanded";
  /** The rail inside the mobile drawer: it has no room at its side, so the menu opens above the row. */
  drawer?: boolean;
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

  const accountLabel = `Account menu for ${session?.user.name ?? ""}`;

  if (isPending) {
    return <Skeleton className={inline ? "h-8 w-20" : "size-8 sm:w-24"} />;
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

  const content = (
    <>
      {rail ? (
        <>
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
        </>
      ) : inline ? (
        <>
          <UserAvatar name={session.user.name} avatar={profile?.avatar} size={24} />
          <span className="hidden min-w-0 truncate sm:block">{session.user.name}</span>
          <span className="sr-only">, account menu</span>
        </>
      ) : compact ? (
        <UserAvatar name={session.user.name} avatar={profile?.avatar} size={32} />
      ) : (
        <>
          <UserIcon aria-hidden="true" className="sm:hidden" />
          <span className="hidden min-w-0 truncate sm:block">{session.user.name}</span>
        </>
      )}
    </>
  );
  const label = rail ? (
    <button
      type="button"
      aria-label={rail === "expanded" ? undefined : accountLabel}
      className={`${railRow} ${rail === "expanded" ? `${railRowExpanded} h-10` : ""}`}
    >
      {content}
    </button>
  ) : inline ? (
    <button
      type="button"
      className="flex h-8 max-w-48 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {content}
    </button>
  ) : compact ? (
    <Button
      variant="ghost"
      size="icon"
      aria-label={accountLabel}
      className="size-10 rounded-full bg-secondary text-sm font-semibold"
    >
      {content}
    </Button>
  ) : (
    <Button
      variant="outline"
      size="icon"
      aria-label={accountLabel}
      className="sm:w-auto sm:max-w-40 sm:px-2.5"
    >
      {content}
    </Button>
  );

  return (
    <Menu
      asChild
      hover={false}
      restoreFocus
      align={compact || rail ? "start" : "end"}
      side={
        drawer
          ? "top"
          : compact || rail
            ? preferences.sidebarSide === "right"
              ? "left"
              : "right"
            : "bottom"
      }
      floatingClassName="w-64 max-w-[calc(100vw-1rem)]"
      title={accountLabel}
      label={label}
    >
      <MenuGroup>
        <div className="px-2 py-1.5">
          <div className="break-words text-sm font-medium">{session.user.name}</div>
          <div className="break-all text-xs text-muted-foreground">{session.user.email}</div>
        </div>
        <MenuSeparator />
        <MenuItem title="Preferences" onClick={() => void navigate({ to: "/preferences" })}>
          <SlidersHorizontalIcon />
          Preferences
        </MenuItem>
        <MenuSeparator />
      </MenuGroup>
      <MenuGroup label="Time format">
        {TIME_FORMATS.map((f) => (
          <MenuItem
            key={f}
            title={TIME_FORMAT_LABEL[f]}
            role="menuitemradio"
            checked={preferences.timeFormat === f}
            onClick={() => set({ timeFormat: f as TimeFormat })}
          >
            {TIME_FORMAT_LABEL[f]}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem
        title="Sign Out"
        className={MENU_ITEM_DESTRUCTIVE}
        disabled={signingOut}
        onClick={() => void signOut()}
      >
        {signingOut ? "Signing out…" : "Sign Out"}
      </MenuItem>
    </Menu>
  );
}
