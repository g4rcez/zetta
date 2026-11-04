import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/features/chat/chat-client";

/**
 * One cache for the whole app: every read has one key, so two components that show the same data share one request.
 * It is a module singleton because code outside React (`refreshAttention`, stores) invalidates keys too.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      // A 4xx answer is final (401, 403, 404); only a network or server failure is worth one more try.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
});
