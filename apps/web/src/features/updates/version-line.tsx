import { useQuery } from "@tanstack/react-query";

import { cn } from "@zetta/ui/lib/utils";
import { updatesQueries, versionText } from "./updates-api";

/**
 * "Version 54121d6 · 2026-11-10": the commit this server was built from and the day of that commit, so a report names its build. Every
 * signed-in person may read it. Nothing is drawn while it loads or when the server cannot answer.
 */
export function VersionLine({ className }: { className?: string }) {
  const { data } = useQuery(updatesQueries.version());
  if (!data) return null;
  return (
    <p className={cn("text-xs text-muted-foreground tabular-nums", className)}>
      {versionText(data.build)}
    </p>
  );
}
