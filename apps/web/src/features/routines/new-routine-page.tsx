import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "@g4rcez/components/alert";

import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { useList } from "../shared/ui";
import { RoutineForm, type RoutineFlow } from "./routine-form";

const NO_BOTS: Bot[] = [];

/** Creating a routine is one focused task, so it has a page of its own: the form, then the new routine's page. */
export function NewRoutinePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const botsQuery = useQuery(chatQueries.bots());
  const bots = botsQuery.data ?? NO_BOTS;
  const [actionError, setError] = useState<string>();
  const [flows] = useList<RoutineFlow>("/api/workflows", "workflows", setError);
  const error = actionError ?? (botsQuery.error ? errorMessage(botsQuery.error) : undefined);
  const back = () => void navigate({ to: "/routines", search: {} });
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6 p-4 md:p-8">
        <Link
          to="/routines"
          search={{}}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Routines
        </Link>
        <header className="space-y-1 border-b pb-5">
          <h1 className="text-2xl text-balance">New routine</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            A routine asks a bot to do something on a schedule and keeps the result in a chat you
            can open.
          </p>
        </header>
        {error && <Alert theme="danger">{error}</Alert>}
        <RoutineForm
          bots={bots}
          flows={flows ?? []}
          onCancel={back}
          onSaved={(created) => {
            void qc.invalidateQueries({ queryKey: ["routines"] });
            // The new routine opens on its own page: its controls, what runs next and its runs.
            if (created)
              void navigate({
                to: "/routines/$routineId",
                params: { routineId: created.id },
                search: {},
              });
            else back();
          }}
        />
      </div>
    </div>
  );
}
