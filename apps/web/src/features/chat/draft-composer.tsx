import type { ComponentProps, RefObject } from "react";

import { Composer } from "./composer";
import { useDraft } from "./use-draft";

export type DraftHandle = ReturnType<typeof useDraft>;

/** The composer of the chat and of a room. It owns its draft text, so each keystroke renders this component and not the whole page. `handle` gives the page adopt/clear. */
export function DraftComposer({
  storageKey,
  handle,
  ...props
}: Omit<ComponentProps<typeof Composer>, "value" | "onChange"> & {
  storageKey: string | undefined;
  handle: RefObject<DraftHandle | null>;
}) {
  const draft = useDraft(storageKey);
  handle.current = draft;
  return <Composer {...props} value={draft.value} onChange={draft.set} />;
}
