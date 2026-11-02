/** Shared geometry of every sidebar row (DESIGN.md "Sidebar rows"): a 32px icon square when the sidebar is collapsed; add
 * `railRowExpanded` for the 28px full-width row with its label. */
export const railRow =
  "relative flex h-8 min-w-8 shrink-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring [&_svg]:text-muted-foreground";
export const railRowExpanded = "h-7 w-full justify-start px-2";
/** Selected: the hover fill, an emerald icon and a bolder label, so it differs from hover. No side stripe. */
export const railRowActive = "bg-sidebar-accent font-semibold text-primary! [&_svg]:text-primary";
/** Section heading above a run of rows. */
export const railGroupLabel = "label-mono px-2 pt-4 pb-1";
export const railLabel = "min-w-0 flex-1 truncate text-left";
