import { CalendarDotsIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Routines } from "./routines";
import type { RoutinesSearch } from "./routines-search";

const NO_BOTS: Bot[] = [];

/** Routines are a main destination: every routine with its status, its one chat and its run history. */
export function RoutinesPage({
  search,
  setSearch,
}: {
  search: RoutinesSearch;
  setSearch: (next: Partial<RoutinesSearch>, history?: "push" | "replace") => void;
}) {
  const botsQuery = useQuery(chatQueries.bots());
  const bots = botsQuery.data ?? NO_BOTS;
  const [actionError, setError] = useState<string>();
  const error = actionError ?? (botsQuery.error ? errorMessage(botsQuery.error) : undefined);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <CalendarDotsIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl text-balance">Routines</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Schedule bots to work for you. Each routine keeps its results in one chat.
            </p>
          </div>
        </header>
        {error && <Alert theme="danger">{error}</Alert>}
        <Routines bots={bots} onError={setError} search={search} setSearch={setSearch} />
      </div>
    </div>
  );
}
