import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "../chat/chat-client";
import { wikiQueries } from "./wiki-api";

/** Every item and link the person can read (GET /api/wiki-graph). Loaded when the graph is opened. */
export function useWikiGraph(enabled: boolean) {
  const query = useQuery({ ...wikiQueries.graph(), enabled });
  const error = query.isError ? errorMessage(query.error) : undefined;
  return {
    data: query.data,
    error,
    loading: enabled && !query.data && !error,
    reload: () => query.refetch(),
  };
}
