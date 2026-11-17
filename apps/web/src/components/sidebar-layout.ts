import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { peopleQueries } from "@/features/people/people-api";
import { saveLocal } from "@/lib/local-storage";

/** `personal`: chat first, a grid of the daily pages, the rest behind "More". `workspace`: labeled sections for a team. */
export type SidebarLayout = "personal" | "workspace";

const CHOICE_KEY = "zetta.sidebar-layout";
const AUTO_KEY = "zetta.sidebar-layout-auto";

const isLayout = (v: unknown): v is SidebarLayout => v === "personal" || v === "workspace";

/**
 * The layout to show. The person's own choice wins. Without one, a workspace with more than one member is `workspace` and a
 * solo account is `personal`. While the members load, the last automatic answer (kept per browser) avoids a flash of the other layout.
 */
export function resolveSidebarLayout(
  choice: SidebarLayout | null,
  members: number | undefined,
  lastAuto: SidebarLayout | null,
): SidebarLayout {
  if (choice) return choice;
  if (members === undefined) return lastAuto ?? "personal";
  return members > 1 ? "workspace" : "personal";
}

function readLayout(key: string): SidebarLayout | null {
  try {
    const v = localStorage.getItem(key);
    return isLayout(v) ? v : null;
  } catch {
    return null;
  }
}

/** The sidebar layout and a setter that remembers the choice in this browser. */
export function useSidebarLayout() {
  const [choice, setChoice] = useState(() => readLayout(CHOICE_KEY));
  const [lastAuto] = useState(() => readLayout(AUTO_KEY));
  const people = useQuery(peopleQueries.list());
  const members = people.data?.length;
  const layout = resolveSidebarLayout(choice, members, lastAuto);
  useEffect(() => {
    if (members !== undefined) saveLocal(AUTO_KEY, members > 1 ? "workspace" : "personal");
  }, [members]);
  const set = useCallback((next: SidebarLayout) => {
    setChoice(next);
    saveLocal(CHOICE_KEY, next);
  }, []);
  return { layout, set };
}
