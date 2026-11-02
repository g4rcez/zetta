import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Button, Checkbox, Input, Select } from "@/components/ui";
import { MentionTextarea } from "../chat/mention";
import { useSidebarData } from "../chat/sidebar-data";

import { errorMessage } from "../chat/chat-client";
import { ConfirmButton, Modal } from "../shared/ui";
import { agendaApi, type AgendaDraft, type AgendaItem, type AgendaKind } from "./agenda-api";
import { KIND_LABEL } from "./agenda-kinds";
import { Alert } from "@g4rcez/components/alert";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

const pad = (n: number) => String(n).padStart(2, "0");
const localDateTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** All-day items are stored at UTC midnight (as Google does); the form works with the calendar date itself. */
const utcDate = (iso: string) => iso.slice(0, 10);
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const REMIND = [
  { value: "start", label: "At the start", before: 0 },
  { value: "10m", label: "10 minutes before", before: 10 * 60_000 },
  { value: "1h", label: "1 hour before", before: 3_600_000 },
  { value: "1d", label: "1 day before", before: 86_400_000 },
  { value: "none", label: "No reminder", before: -1 },
] as const;

function remindChoice(item: AgendaItem | undefined, kind: AgendaKind) {
  if (!item) return kind === "task" || kind === "reminder" ? "start" : "none";
  if (!item.remindAt) return "none";
  const diff = new Date(item.startAt).getTime() - new Date(item.remindAt).getTime();
  return REMIND.find((r) => r.before === diff)?.value ?? "keep";
}

export function AgendaItemModal({
  item,
  at,
  syncEnabled,
  onClose,
  onSaved,
  onError,
}: {
  item?: AgendaItem | undefined;
  at?: Date | undefined;
  syncEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const tf = useTimeFormat();
  const { bots } = useSidebarData();
  const start = item
    ? new Date(item.startAt)
    : (at ?? new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000));
  const [kind, setKind] = useState<AgendaKind>(item?.kind ?? "task");
  const [allDay, setAllDay] = useState(item?.allDay ?? false);
  const [remind, setRemind] = useState<string>(remindChoice(item, item?.kind ?? "task"));
  const [toGoogle, setToGoogle] = useState(item?.syncToGoogle ?? false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string>();
  const readOnly = item?.source === "google" && !syncEnabled;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const startAt = allDay ? new Date(`${s("startDate")}T00:00:00Z`) : new Date(s("start"));
    const endRaw = allDay ? s("endDate") : s("end");
    const endAt = endRaw
      ? allDay
        ? new Date(new Date(`${endRaw}T00:00:00Z`).getTime() + 86_400_000)
        : new Date(endRaw)
      : null;
    if (Number.isNaN(startAt.getTime())) {
      setLocal("Pick a start date.");
      return;
    }
    if (endAt && endAt.getTime() < startAt.getTime()) {
      setLocal("The end must be after the start.");
      return;
    }
    const r = REMIND.find((x) => x.value === remind);
    const remindAt =
      remind === "keep"
        ? undefined
        : !r || r.before < 0
          ? null
          : new Date(startAt.getTime() - r.before).toISOString();
    const draft: AgendaDraft = {
      kind,
      title: s("title"),
      description: s("description"),
      location: s("location"),
      allDay,
      startAt: startAt.toISOString(),
      endAt: endAt?.toISOString() ?? null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(remindAt !== undefined ? { remindAt } : {}),
      ...(syncEnabled ? { syncToGoogle: toGoogle } : {}),
    };
    setBusy(true);
    setLocal(undefined);
    try {
      // A Google event that is not synced any more keeps its details; only the local reminder can change.
      if (item && readOnly)
        await agendaApi.update(item.id, item.version, remindAt !== undefined ? { remindAt } : {});
      else if (item) await agendaApi.update(item.id, item.version, draft);
      else await agendaApi.create(draft);
      onSaved();
      onClose();
    } catch (x) {
      setLocal(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      onSaved();
      onClose();
    } catch (x) {
      onError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };

  const endValue = item?.endAt
    ? item.allDay
      ? utcDate(new Date(new Date(item.endAt).getTime() - 86_400_000).toISOString())
      : localDateTime(new Date(item.endAt))
    : "";
  return (
    <Modal
      title={item ? `Edit ${KIND_LABEL[item.kind].toLowerCase()}` : "Add to Agenda"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3"
        aria-label={item ? "Edit Agenda item" : "New Agenda item"}
      >
        {item?.source === "bot" && (
          <p className="text-xs text-muted-foreground">
            Added by a bot
            {item.conversationId ? (
              <>
                {" "}
                in{" "}
                <Link
                  to="/chat/{-$chatId}"
                  params={{ chatId: item.conversationId }}
                  className="underline"
                >
                  this conversation
                </Link>
              </>
            ) : null}
            .
          </p>
        )}
        {item?.source === "google" && (
          <p className="text-xs text-muted-foreground">
            From Google Calendar.
            {readOnly ? " Turn on sync to edit it here." : " Changes are sent back to Google."}
          </p>
        )}
        {item?.syncState === "error" && (
          <Alert theme="danger">
            {item.syncError || "This item could not be synced with Google."}
          </Alert>
        )}
        <Select
          title="Type"
          required
          value={kind}
          disabled={readOnly}
          onChange={(e) => {
            const k = e.target.value as AgendaKind;
            setKind(k);
            if (!item) setRemind(k === "task" || k === "reminder" ? "start" : "none");
          }}
          options={(Object.keys(KIND_LABEL) as AgendaKind[]).map((k) => ({
            value: k,
            label: KIND_LABEL[k],
          }))}
        />
        <Input
          title="Title"
          name="title"
          required
          maxLength={200}
          defaultValue={item?.title ?? ""}
          disabled={readOnly}
          placeholder="e.g. Call Ana about the contract"
          autoFocus
        />
        <Checkbox
          checked={allDay}
          disabled={readOnly}
          onChange={(e) => setAllDay(e.target.checked)}
        >
          All day
        </Checkbox>
        <div className="grid gap-3 sm:grid-cols-2">
          {allDay ? (
            <>
              <Input
                key="sd"
                title="Date"
                name="startDate"
                type="date"
                required
                disabled={readOnly}
                defaultValue={item?.allDay ? utcDate(item.startAt) : localDate(start)}
              />
              <Input
                key="ed"
                title="Until (optional)"
                name="endDate"
                type="date"
                required={false}
                disabled={readOnly}
                defaultValue={item?.allDay ? endValue : ""}
              />
            </>
          ) : (
            <>
              <Input
                key="s"
                title="Starts"
                name="start"
                type="datetime-local"
                required
                disabled={readOnly}
                defaultValue={localDateTime(start)}
              />
              <Input
                key="e"
                title="Ends (optional)"
                name="end"
                type="datetime-local"
                required={false}
                disabled={readOnly}
                defaultValue={item && !item.allDay ? endValue : ""}
              />
            </>
          )}
        </div>
        <Select
          title="Remind me"
          required={false}
          value={remind}
          onChange={(e) => setRemind(e.target.value)}
          options={[
            ...(remind === "keep"
              ? [{ value: "keep", label: `Keep (${formatDateTime(item!.remindAt!, tf)})` }]
              : []),
            ...REMIND.map((r) => ({ value: r.value, label: r.label })),
          ]}
        />
        <Input
          title="Location"
          name="location"
          required={false}
          maxLength={200}
          disabled={readOnly}
          defaultValue={item?.location ?? ""}
        />
        <MentionTextarea
          title="Notes"
          name="description"
          bots={bots}
          required={false}
          rows={3}
          maxLength={4000}
          disabled={readOnly}
          defaultValue={item?.description ?? ""}
        />
        {syncEnabled && (
          <Checkbox
            checked={toGoogle}
            disabled={Boolean(item?.googleEventId)}
            onChange={(e) => setToGoogle(e.target.checked)}
          >
            {item?.googleEventId ? "On Google Calendar" : "Also add to Google Calendar"}
          </Checkbox>
        )}
        {local && (
          <p role="alert" className="text-sm text-destructive">
            {local}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex gap-2">
            {item && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void act(() => agendaApi.complete(item.id, item.status !== "done"))}
              >
                {item.status === "done" ? "Reopen" : "Mark done"}
              </Button>
            )}
            {item && (
              <ConfirmButton
                label="Delete"
                question={
                  item.googleEventId
                    ? "Delete this item here and on Google Calendar?"
                    : "Delete this item?"
                }
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={() => act(() => agendaApi.remove(item.id))}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy} disabled={busy}>
              {item ? "Save" : "Add"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
