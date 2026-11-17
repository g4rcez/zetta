import { useState, type FormEvent } from "react";

import { AdvancedSection } from "@/components/advanced-section";
import { BotSelect } from "@/components/bot-select";
import { Button, Input, Radiobox, Select } from "@/components/ui";

import { ApiError, call, errorMessage, type Bot } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import {
  buildSchedule,
  scheduleText,
  type ScheduleMode,
  type SchedulePayload,
} from "../studio/routine-schedule";
import { NextRuns, type Routine } from "./routines";

export type RoutineFlow = { id: string; name: string };

const WHEN_EXAMPLES = "Monday to Friday at 8:30 · every 15 minutes · tomorrow at 5pm · 0 9 * * 1-5";
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const CREATE_MODES = [
  ["text", "Describe it"],
  ["daily", "Every day"],
  ["interval", "Every few minutes"],
  ["once", "Once"],
] as const;
/** A one-time routine's date cannot be changed, so editing offers the other three. */
const EDIT_MODES = CREATE_MODES.filter(([v]) => v !== "once");

type Understood = { text: string; assumed: string | null };

/** The timezone as one line; "Change" shows the field. The form always carries the zone (a hidden field or the input). */
function TimezoneField({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const [changing, setChanging] = useState(false);
  if (changing)
    return (
      <Input
        title="Time zone"
        name="timezone"
        required
        autoComplete="off"
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        container="sm:col-span-2"
      />
    );
  return (
    <p className="text-sm text-muted-foreground sm:col-span-2">
      <input type="hidden" name="timezone" value={value} />
      Time zone: <span className="font-medium text-foreground">{value}</span>
      {" · "}
      <button
        type="button"
        onClick={() => setChanging(true)}
        // No hint: it has visible text.
        className="rounded text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        Change
      </button>
    </p>
  );
}

/** What the server understood the schedule as, then the next runs. */
function SchedulePreview({
  nextRuns,
  understood,
}: {
  nextRuns: string[];
  understood: Understood | undefined;
}) {
  return (
    <div className="sm:col-span-2" role="status">
      {understood && (
        <p className="mb-1 text-sm">
          Understood as <span className="font-medium">{understood.text}</span>
          {understood.assumed && (
            <span className="block text-xs text-muted-foreground">{understood.assumed}</span>
          )}
        </p>
      )}
      <p className="text-xs font-medium">Next runs</p>
      <NextRuns runs={nextRuns} />
    </div>
  );
}

/**
 * The one routine form: it creates a routine (the New routine page) and edits one (the routine's own page). The default view is the
 * bot, a title, what to do, when, a preview and the save button; the workflow and the cron examples sit under "Advanced".
 */
export function RoutineForm({
  bots,
  flows,
  routine,
  onSaved,
  onCancel,
}: {
  bots: Bot[];
  flows: RoutineFlow[];
  /** The routine to edit. Leave it out to create one. */
  routine?: Routine;
  onSaved: (routine?: Routine) => void;
  onCancel: () => void;
}) {
  const editing = Boolean(routine);
  const oneTime = routine?.kind === "once";
  const [mode, setMode] = useState<ScheduleMode>(
    !routine ? "text" : routine.dailyAt ? "daily" : "interval",
  );
  const [tz, setTz] = useState(routine?.timezone || localTz());
  const [nextRuns, setNextRuns] = useState<string[]>();
  // What the server understood the written schedule as, and anything it had to assume, shown next to the next runs.
  const [understood, setUnderstood] = useState<Understood>();
  const [formError, setFormError] = useState<string>();
  const schedule = (f: FormData) =>
    buildSchedule({
      mode,
      timezone: String(f.get("timezone") ?? "") || tz,
      dailyAt: String(f.get("dailyAt") ?? ""),
      everyMinutes: String(f.get("everyMinutes") ?? ""),
      onceLocal: String(f.get("onceLocal") ?? ""),
      text: String(f.get("scheduleText") ?? ""),
    });
  async function preview(form: HTMLFormElement) {
    setFormError(undefined);
    setNextRuns(undefined);
    setUnderstood(undefined);
    const s = schedule(new FormData(form));
    if (!s.ok) return setFormError(s.problem);
    try {
      const r = await call<{ nextRuns: string[]; understood?: string; assumed?: string | null }>(
        "/api/routines/preview",
        "POST",
        s.value,
      );
      setNextRuns(r.nextRuns);
      if (r.understood) setUnderstood({ text: r.understood, assumed: r.assumed ?? null });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    const f = new FormData(e.currentTarget);
    // A one-time routine keeps its date: only the zone is sent with it.
    let when: SchedulePayload = { timezone: String(f.get("timezone") ?? "") || tz };
    if (!oneTime) {
      const s = schedule(f);
      if (!s.ok) return setFormError(s.problem);
      when = s.value;
    }
    const workflowId = String(f.get("workflowId") ?? "");
    const common = {
      botId: f.get("botId"),
      title: f.get("title"),
      prompt: f.get("prompt"),
      ...when,
      ...(workflowId ? { workflowId } : {}),
    };
    try {
      if (routine) {
        await call(`/api/routines/${routine.id}`, "PATCH", {
          expectedVersion: routine.version,
          ...common,
        });
        onSaved();
      } else {
        const r = await call<{ routine: Routine }>("/api/routines", "POST", {
          ...common,
          // Switched on at once: a routine left paused runs only when "Run now" is pressed, which reads as "it ran once and stopped".
          activate: "on",
        });
        onSaved(r.routine);
      }
    } catch (x) {
      setFormError(
        x instanceof ApiError && x.code === "STALE_VERSION"
          ? "This routine was changed somewhere else. Close this form to reload, then try again."
          : errorMessage(x),
      );
    }
  }
  const modes = editing ? EDIT_MODES : CREATE_MODES;
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid gap-3 sm:grid-cols-2"
      aria-label={routine ? `Edit ${routine.title}` : "New routine"}
    >
      <BotSelect
        label="Bot"
        name="botId"
        required
        bots={bots}
        defaultValue={routine?.botId}
        placeholder="Choose a bot"
      />
      <Input title="Title" name="title" required maxLength={120} defaultValue={routine?.title} />
      <MentionTextarea
        title="What should it do?"
        className="sm:col-span-2"
        name="prompt"
        bots={bots}
        defaultValue={routine?.prompt}
        required
        rows={3}
      />
      {oneTime ? (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          The date of a one-time routine cannot be changed. Create a new routine for another date.
        </p>
      ) : (
        <>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm">When</legend>
            {routine && (
              <p className="mt-1 text-xs text-muted-foreground">Now: {scheduleText(routine)}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-3 text-sm">
              {modes.map(([v, l]) => (
                <Radiobox
                  key={v}
                  name="mode"
                  checked={mode === v}
                  onChange={() => {
                    setMode(v);
                    setNextRuns(undefined);
                    setUnderstood(undefined);
                  }}
                >
                  {l}
                </Radiobox>
              ))}
            </div>
          </fieldset>
          {mode === "text" && (
            <div className="sm:col-span-2">
              <Input
                title="When should it run?"
                name="scheduleText"
                autoComplete="off"
                required
                maxLength={200}
                placeholder="Monday to Friday at 8:30"
              />
            </div>
          )}
          {mode === "daily" && (
            <Input
              title="Time of day"
              name="dailyAt"
              type="time"
              required
              defaultValue={routine?.dailyAt ?? undefined}
            />
          )}
          {mode === "interval" && (
            <Input
              title="Every how many minutes (5 or more)"
              name="everyMinutes"
              type="number"
              min={5}
              max={10080}
              defaultValue={routine?.everyMinutes ?? 60}
              required
            />
          )}
          {mode === "once" && (
            <Input title="Date and time" name="onceLocal" type="datetime-local" required />
          )}
        </>
      )}
      <TimezoneField value={tz} onChange={setTz} />
      {nextRuns && <SchedulePreview nextRuns={nextRuns} understood={understood} />}
      <AdvancedSection className="sm:col-span-2">
        {mode === "text" && !oneTime && (
          <p className="text-xs text-muted-foreground">
            Say it in words or write a cron. For example: {WHEN_EXAMPLES}
          </p>
        )}
        <Select
          title="Run a workflow instead (optional)"
          required={false}
          name="workflowId"
          defaultValue={routine?.workflowId ?? ""}
          options={[
            { value: "", label: "No, just ask the bot" },
            ...flows.map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
      </AdvancedSection>
      {formError && (
        <p role="alert" className="text-destructive sm:col-span-2">
          {formError}
        </p>
      )}
      {!editing && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          The routine is switched on when you create it. You can pause it at any time.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {!oneTime && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => void preview(e.currentTarget.form!)}
          >
            Preview schedule
          </Button>
        )}
        <Button type="submit" size="sm">
          {editing ? "Save changes" : "Create routine"}
        </Button>
      </div>
    </form>
  );
}
