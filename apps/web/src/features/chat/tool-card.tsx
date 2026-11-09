import { useState } from "react";
import { ShieldWarningIcon } from "@phosphor-icons/react";

import { BotIdentity } from "@/components/bot-identity";
import { Button, Checkbox, Input } from "@/components/ui";
import { relativeTime } from "../shared/relative-time";
import type { Bot } from "./chat-client";

/** What the server keeps in the card of a paused plugin call (apps/server/src/modules/chat/service.ts, kind tool_resume). */
export type PausedCallPatch = {
  plugin: string;
  title?: string;
  pause: {
    requestId: string;
    mode: "approval" | "input";
    tool: string;
    message: string;
    input?: string;
    fields?: {
      key: string;
      label: string;
      type: "string" | "number" | "boolean";
      required: boolean;
    }[];
    expiresAt: number;
  };
};
export type FormAnswer = Record<string, string | number | boolean>;

/** The answer to send for the typed form values, or why it is not ready. A blank optional field is left out. */
export function buildAnswer(
  fields: NonNullable<PausedCallPatch["pause"]["fields"]>,
  values: Record<string, string | boolean>,
): { answer: FormAnswer } | { missing: string } {
  const answer: FormAnswer = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === "boolean") {
      answer[f.key] = v === true;
      continue;
    }
    const text = typeof v === "string" ? v.trim() : "";
    if (!text) {
      if (f.required) return { missing: f.label };
      continue;
    }
    if (f.type === "number") {
      const n = Number(text);
      if (!Number.isFinite(n)) return { missing: f.label };
      answer[f.key] = n;
    } else answer[f.key] = text;
  }
  return { answer };
}

/**
 * A tool of a connected service stopped to ask the person: either to approve one call (the exact input is shown) or to fill a form.
 * Nothing runs until they answer; "Decline" tells the service no. The texts come from the service, so they are shown as plain text.
 */
export function ToolPauseCard({
  asker,
  patch,
  expiresAt,
  busy,
  error,
  onDecide,
}: {
  asker?: Pick<Bot, "id" | "name"> | undefined;
  patch: PausedCallPatch;
  expiresAt?: string | undefined;
  busy: boolean;
  error?: string | undefined;
  onDecide: (approve: boolean, answer?: FormAnswer) => void;
}) {
  const { pause } = patch;
  const fields = pause.fields ?? [];
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [problem, setProblem] = useState<string>();
  const left = expiresAt ? relativeTime(expiresAt) : "";
  const input = pause.mode === "input";
  function send() {
    if (!input) return onDecide(true);
    const r = buildAnswer(fields, values);
    if ("missing" in r) return setProblem(`${r.missing} needs a value.`);
    setProblem(undefined);
    onDecide(true, r.answer);
  }
  return (
    <div
      role="group"
      aria-label={input ? "A tool asks you a question" : "A tool asks for your approval"}
      className="space-y-3 rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShieldWarningIcon className="text-warn" aria-hidden="true" />
        {asker && <BotIdentity bot={asker as Bot} size={24} className="w-auto flex-none" />}
        <span>{input ? "needs an answer for" : "asks to run"}</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{pause.tool}</code>
      </div>
      {pause.message && (
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {pause.message}
        </p>
      )}
      {!input && pause.input && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-xs">
          {pause.input}
        </pre>
      )}
      {input && (
        <div className="space-y-2">
          {fields.map((f) =>
            f.type === "boolean" ? (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={values[f.key] === true}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked }))}
                />
                {f.label}
              </label>
            ) : (
              <Input
                key={f.key}
                title={f.required ? f.label : `${f.label} (optional)`}
                type={f.type === "number" ? "number" : "text"}
                maxLength={4000}
                value={typeof values[f.key] === "string" ? (values[f.key] as string) : ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ),
          )}
        </div>
      )}
      {left && (
        <p className="text-xs text-muted-foreground">
          Expires {left === "now" ? "any moment" : left}
        </p>
      )}
      {(problem || error) && (
        <p role="alert" className="text-xs text-destructive">
          {problem ?? error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => onDecide(false)}>
          Decline
        </Button>
        <Button size="sm" variant="success" disabled={busy} onClick={send}>
          {input ? "Send answer" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
