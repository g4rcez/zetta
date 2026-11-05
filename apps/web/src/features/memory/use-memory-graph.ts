import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "../chat/chat-client";
import { memoryQueries } from "./memory-api";

/** Every item and link the person can read (GET /api/memory-graph). Loaded when the graph is opened. */
export function useMemoryGraph(enabled: boolean) {
  const query = useQuery({ ...memoryQueries.graph(), enabled });
  const error = query.isError ? errorMessage(query.error) : undefined;
  return {
    data: query.data,
    error,
    loading: enabled && !query.data && !error,
    reload: () => query.refetch(),
  };
}
