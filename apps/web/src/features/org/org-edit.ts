import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import { toast } from "@/lib/notify";
import { errorMessage } from "../chat/chat-client";
import { orgQueries, type OrgView } from "./org-api";

/** One write of the chart, queued behind the others; resolves to the fresh chart, or undefined when the write failed. */
export type OrgRun = (
  work: (version: number) => Promise<OrgView>,
  done?: string,
) => Promise<OrgView | undefined>;

/**
 * Runs the writes of the chart one at a time. Each one is given the version of the chart the last write returned, so two quick drags
 * never carry the same version and refuse each other. A failure shows its message (the server words it for a person) and reloads the
 * chart, so the page never keeps showing what the server turned down. Returns the fresh chart, or undefined when the write failed.
 */
export function useOrgEdit() {
  const qc = useQueryClient();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(
    (work: (version: number) => Promise<OrgView>, done?: string) => {
      const run = async (): Promise<OrgView | undefined> => {
        const version = qc.getQueryData<OrgView>(orgQueries.get().queryKey)?.chart.version ?? 0;
        try {
          const view = await work(version);
          qc.setQueryData(orgQueries.get().queryKey, view);
          if (done) toast.success(done);
          return view;
        } catch (e) {
          toast.error(errorMessage(e));
          await qc.invalidateQueries({ queryKey: orgQueries.get().queryKey });
          return undefined;
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next;
      return next;
    },
    [qc],
  );
}
