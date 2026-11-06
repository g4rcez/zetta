import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { Skeleton } from "@g4rcez/components";
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
    return <Skeleton as="div" decorative className={inline ? "h-8 w-20" : "size-8 sm:w-24"} />;
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // With visible text the name starts with it (WCAG 2.5.3); icon-only forms keep a label.
        aria-label={
          rail === "expanded" || inline ? undefined : `Account menu for ${session.user.name}`
        }
        render={
          rail ? (
            <button
              type="button"
              className={`${railRow} ${rail === "expanded" ? `${railRowExpanded} h-10` : ""}`}
            />
          ) : inline ? (
            <button
              type="button"
              className="flex h-8 max-w-48 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          ) : compact ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-full bg-secondary text-sm font-semibold"
            />
          ) : (
            <Button variant="outline" size="icon" className="sm:w-auto sm:max-w-40 sm:px-2.5" />
          )
        }
      >
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact || rail ? "start" : "end"}
        side={compact || rail ? (preferences.sidebarSide === "right" ? "left" : "right") : "bottom"}
        className="w-64 max-w-[calc(100vw-1rem)] bg-card"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="break-words">{session.user.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="break-all">{session.user.email}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link to="/preferences" />}>
            <SlidersHorizontalIcon />
            Preferences
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Time format</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preferences.timeFormat}
            onValueChange={(value) => set({ timeFormat: value as TimeFormat })}
          >
            {TIME_FORMATS.map((f) => (
              <DropdownMenuRadioItem key={f} value={f}>
                {TIME_FORMAT_LABEL[f]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? "Signing out…" : "Sign Out"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
