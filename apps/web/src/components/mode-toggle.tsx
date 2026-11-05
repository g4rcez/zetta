import { Button } from "@/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";

import { usePreferences } from "@/features/preferences/preferences";
import { railLabel, railRow, railRowExpanded } from "@/components/rail-row";

export function ModeToggle({
  compact = false,
  inline = false,
  rail,
}: {
  compact?: boolean;
  inline?: boolean;
  rail?: "collapsed" | "expanded";
}) {
  const { set } = usePreferences();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          rail ? (
            <button
              type="button"
              className={`${railRow} ${rail === "expanded" ? railRowExpanded : ""}`}
            />
          ) : inline ? (
            <button
              type="button"
              className="relative grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          ) : (
            <Button
              variant={compact ? "ghost" : "outline"}
              size="icon"
              className={compact ? "size-10 rounded-md text-muted-foreground" : ""}
            />
          )
        }
      >
        {rail ? (
          <>
            <span className="relative grid size-4 shrink-0 place-items-center">
              <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
              <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
            </span>
            {rail === "expanded" ? <span className={railLabel}>Theme</span> : null}
            <span className="sr-only">Toggle theme</span>
          </>
        ) : (
          <>
            <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
            <span className="sr-only">Toggle theme</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact || rail ? "start" : "end"}
        side={compact || rail ? "right" : "bottom"}
      >
        <DropdownMenuItem onClick={() => set({ theme: "light" })}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => set({ theme: "dark" })}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => set({ theme: "system" })}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
