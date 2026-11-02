import { useCallback, useEffect, useState } from "react";

import { call, errorMessage } from "../chat/chat-client";
import type { GraphData } from "./wiki-graph";

/** Every item and link the person can read (GET /api/wiki-graph). Loaded when the graph is opened. */
export function useWikiGraph(enabled: boolean) {
  const [data, setData] = useState<GraphData>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    () =>
      call<GraphData>("/api/wiki-graph").then(
        (d) => {
          setData(d);
          setError(undefined);
        },
        (e) => setError(errorMessage(e)),
      ),
    [],
  );
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { data, error, loading: enabled && !data && !error, reload: load };
}
