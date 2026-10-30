/** Shared geometry of every sidebar row: icon only and centered; add `railRowExpanded` to reveal the label. */
export const railRow =
  "relative flex h-10 min-w-10 items-center justify-center gap-3 overflow-hidden whitespace-nowrap rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring";
export const railRowExpanded = "md:w-full md:justify-start md:px-3.5";
export const railRowActive =
  "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary";
/** Section heading above a run of rail rows; collapsed rails show a hairline instead. */
export const railGroupLabel = "label-mono hidden px-3.5 pt-3 pb-1 md:block";
export const railLabel = "hidden min-w-0 truncate md:inline";
