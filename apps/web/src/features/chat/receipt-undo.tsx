import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui";
import { call, errorMessage, type Receipt } from "./chat-client";

type UndoState = "idle" | "busy" | "done" | "failed";

/** What Undo does for a memory receipt: a new item is archived, a changed one goes back to the version before this write. */
export function memoryUndo(
  r: Receipt,
): { path: string; method: "PATCH" | "POST"; body: object } | undefined {
  const path = `/api/memory/${encodeURIComponent(r.id)}`;
  if (r.created !== false) return { path, method: "PATCH", body: { status: "archived" } };
  if (r.version && r.version > 1)
    return { path: `${path}/restore`, method: "POST", body: { version: r.version - 1 } };
  return undefined;
}

/** Undo for a write the bot made without asking (it applied because you asked for the work). Shown next to its receipt. */
export function ReceiptUndo({ receipt }: { receipt: Receipt }) {
  const [state, setState] = useState<UndoState>("idle");
  const [error, setError] = useState<string>();
  const action = receipt.kind === "memory" ? memoryUndo(receipt) : undefined;
  if (!action) return null;
  if (state === "done") return <span className="text-xs">undone</span>;
  return (
    <>
      {/* No hint: the button has visible text. */}
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Undo: ${receipt.text}`}
        disabled={state === "busy"}
        onClick={() => {
          setState("busy");
          call(action.path, action.method, action.body)
            .then(() => setState("done"))
            .catch((e) => {
              setError(errorMessage(e));
              setState("failed");
            });
        }}
      >
        Undo
      </Button>
      {state === "failed" && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

const SKILL_VERB = {
  created: "Created skill",
  revised: "Revised skill",
  suggested: "Suggests skill",
} as const;

/**
 * Autolearn's receipt: "Created skill X" / "Revised skill X" with View and Undo, or "Suggests skill X" with Save when the bot is set
 * to ask first. Undo archives a created skill or puts back the version before a revision.
 */
export function SkillReceipt({ receipt, readOnly }: { receipt: Receipt; readOnly: boolean }) {
  const [state, setState] = useState<UndoState>("idle");
  const [error, setError] = useState<string>();
  const learn = receipt.learn ?? (receipt.created === false ? "revised" : "created");
  const act = (path: string) => {
    setState("busy");
    call(path, "POST")
      .then(() => setState("done"))
      .catch((e) => {
        setError(errorMessage(e));
        setState("failed");
      });
  };
  return (
    <>
      <span>
        {SKILL_VERB[learn]} “{receipt.text}”
      </span>
      {learn !== "suggested" && (
        <Link to="/skills" className="underline hover:text-foreground">
          View
        </Link>
      )}
      {!readOnly && state === "done" ? (
        <span>{learn === "suggested" ? "saved" : "undone"}</span>
      ) : !readOnly ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={state === "busy"}
          onClick={() =>
            act(
              learn === "suggested"
                ? `/api/skill-reviews/${receipt.id}/apply`
                : `/api/skills/${receipt.id}/undo-learned`,
            )
          }
        >
          {learn === "suggested" ? "Save skill" : "Undo"}
        </Button>
      ) : null}
      {state === "failed" && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </>
  );
}
