import { ArrowCircleUpIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { ActionHint } from "@/components/action-hint";
import { railLabel, railRow, railRowExpanded } from "@/components/rail-row";
import { cn } from "@zetta/ui/lib/utils";
import { useUpdateStatus } from "./updates-api";

/**
 * A quiet "Update available" row at the foot of the sidebar, for the administrator only, and only while the daily check says a newer
 * version is published. It is a link to the Update page, which lists the changes and the one command. A member never sees it.
 */
export function UpdateMark({ collapsed }: { collapsed: boolean }) {
  const status = useUpdateStatus();
  if (status?.state !== "behind") return null;
  const row = (
    // No hint: expanded, it shows the text Update available; collapsed, the ActionHint below wraps it.
    <Link
      to="/update"
      aria-label="Update available"
      className={cn(railRow, !collapsed && railRowExpanded)}
    >
      <ArrowCircleUpIcon aria-hidden="true" className="size-4 shrink-0 text-primary!" />
      {!collapsed && <span className={railLabel}>Update available</span>}
    </Link>
  );
  return collapsed ? <ActionHint label="Update available">{row}</ActionHint> : row;
}
