import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { Skeleton } from "@zetta/ui/components/skeleton";
import { UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { AuthenticationRequestError } from "@/lib/auth-transport";

export default function UserMenu({ compact = false, inline = false }: { compact?: boolean; inline?: boolean }) {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
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
    } catch { // no-excuse-ok: catch -- report only a fixed message at the user action boundary.
      toast.error("Could not confirm sign out. Check your connection, then try again.");
    } finally {
      signOutPending.current = false;
      setSigningOut(false);
    }
  }

  if (isPending) {
    return <Skeleton className={inline ? "h-8 w-20" : "size-8 sm:w-24"} />;
  }

  if (!session) {
    return (
      <Link to="/login">
        {inline ? <span className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-accent">Sign In</span> : <Button variant="outline">Sign In</Button>}
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${session.user.name}`}
        render={inline ? <button type="button" className="flex h-8 max-w-48 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring" /> : compact ? <Button variant="ghost" size="icon" className="size-10 rounded-full bg-secondary text-sm font-semibold" /> : <Button variant="outline" size="icon" className="sm:w-auto sm:max-w-40 sm:px-2.5" />}
      >
        {inline ? <><span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">{session.user.name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden min-w-0 truncate sm:block">{session.user.name}</span></> : compact ? <span aria-hidden="true">{session.user.name.slice(0, 1).toUpperCase()}</span> : <><UserRound aria-hidden="true" className="sm:hidden" />
        <span className="hidden min-w-0 truncate sm:block">{session.user.name}</span></>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "start" : "end"} side={compact ? "right" : "bottom"} className="w-64 max-w-[calc(100vw-1rem)] bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="break-words">{session.user.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="break-all">{session.user.email}</DropdownMenuItem>
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
