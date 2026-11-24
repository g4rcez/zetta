import { PhoneDisconnectIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui";
import { formatPhone } from "./format";
import { phoneApi, phoneQueries, type LivePhoneCall } from "./phone-api";

/** One call that runs now, with the button that ends it. */
export function LiveCallCard({
  call,
  busy,
  error,
  onHangUp,
}: {
  call: Pick<LivePhoneCall, "botName" | "number" | "status">;
  busy: boolean;
  error?: string | undefined;
  onHangUp: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="A phone call is running"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm"
    >
      <span className="min-w-0 flex-1 break-words">
        {call.botName} is {call.status === "ringing" ? "calling" : "on a call with"}{" "}
        <span className="font-medium">{call.number ? formatPhone(call.number) : "a number"}</span>
      </span>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <Button size="sm" variant="destructive" disabled={busy} onClick={onHangUp}>
        <PhoneDisconnectIcon aria-hidden="true" /> Hang up
      </Button>
    </div>
  );
}

/**
 * The calls bots placed for the chat that is open, while they run. It looks only where the installation has phone on, and only for a call
 * this chat asked for. The server ends the call; the outcome then arrives in the chat as a note.
 */
export function PhoneLiveCalls({ conversationId }: { conversationId: string | undefined }) {
  const offer = useQuery(phoneQueries.offer());
  const live = useQuery({
    ...phoneQueries.live(),
    enabled: Boolean(conversationId) && offer.data?.on === true,
    refetchInterval: (q) => (q.state.data?.length ? 3_000 : 8_000),
  });
  const hang = useMutation({
    mutationFn: (id: string) => phoneApi.hangUp(id),
    onSettled: () => void live.refetch(),
  });
  const mine = (live.data ?? []).filter((c) => c.requestedIn === conversationId);
  if (!mine.length) return null;
  return (
    <div className="space-y-2">
      {mine.map((c) => (
        <LiveCallCard
          key={c.id}
          call={c}
          busy={hang.isPending}
          error={
            hang.isError && hang.variables === c.id
              ? "The call could not be ended from here."
              : undefined
          }
          onHangUp={() => hang.mutate(c.id)}
        />
      ))}
    </div>
  );
}
