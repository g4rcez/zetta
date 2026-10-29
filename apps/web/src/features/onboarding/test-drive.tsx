import { useEffect, useState } from "react";
import { Alert } from "@g4rcez/components/alert";

import { BotAvatar } from "@/components/bot-avatar";
import { Button } from "@/components/ui";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import type { Row } from "../chat/chat-rows";
import { useZettaChat } from "../chat/use-zetta-chat";

const HELLO = "Hi! In two or three sentences, tell me what you can do for me.";
type Outcome = "asking" | "ready" | "retry";

/** The last setup step: one real exchange with the Chief, then an explicit yes. The server only marks the Chief ready after a real reply and that answer. */
export function TestDrive({
  chief,
  onChief,
  onAdjust,
}: {
  chief: Bot;
  onChief: (bot: Bot) => void;
  onAdjust: () => void;
}) {
  const [conversationId, setConversationId] = useState<string>();
  const [rows, setRows] = useState<Row[]>([]);
  const [settled, setSettled] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("asking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const main = useZettaChat({ conversationId, onSettled: () => setSettled(true) });

  // useChat drops its transient messages once the turn is saved; keep what the person saw.
  useEffect(() => {
    if (main.rows.length) setRows(main.rows);
  }, [main.rows]);

  async function hello() {
    setError(undefined);
    setBusy(true);
    try {
      const created = await chatClient.startConversation(chief.id);
      setConversationId(created.id);
      setSettled(false);
      void main.send(HELLO, { conversationId: created.id });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function answer(satisfied: boolean) {
    if (!conversationId) return;
    setError(undefined);
    setBusy(true);
    try {
      const q = await chatClient.askOnboarding(chief.id, conversationId);
      const bot = await chatClient.answerOnboarding(chief.id, {
        conversationId,
        questionId: q.questionId,
        expectedVersion: chief.version,
        satisfied,
      });
      onChief({ ...chief, ...bot });
      setOutcome(satisfied ? "ready" : "retry");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const reply = rows.find((r) => r.role === "assistant" && r.content.trim());
  const failed = Boolean(main.error) || reply?.status === "failed";
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3">
        <BotAvatar bot={chief} size={44} square />
        <div>
          <p className="font-semibold">{chief.name}</p>
          <p className="text-muted-foreground">
            {chief.description || "Your personal chief of staff."}
          </p>
        </div>
      </div>
      {error && <Alert theme="danger">{error}</Alert>}
      {failed && (
        <Alert theme="danger">
          Your Chief could not answer. Check its engine is installed and signed in, then try again.
        </Alert>
      )}
      {!conversationId || failed ? (
        <Button type="button" disabled={busy} onClick={() => void hello()}>
          {busy ? "Sending…" : failed ? "Try again" : "Say hello"}
        </Button>
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {r.role === "user" ? "You" : chief.name}
              </p>
              <p className="whitespace-pre-wrap">{r.content || (r.activity ?? "Thinking…")}</p>
            </li>
          ))}
        </ul>
      )}
      {settled && reply && !failed && outcome === "asking" && (
        <div
          role="group"
          aria-label="Onboarding"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2"
        >
          <p>Are you satisfied with how {chief.name} answers?</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void answer(true)}>
              Yes, I'm satisfied
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void answer(false)}
            >
              Not yet
            </Button>
          </div>
        </div>
      )}
      {outcome === "ready" && <Alert theme="success">{chief.name} is ready for work.</Alert>}
      {outcome === "retry" && (
        <Alert theme="info">
          Okay. Adjust the personality or engine, then test again.{" "}
          <button type="button" className="underline underline-offset-2" onClick={onAdjust}>
            Adjust my Chief
          </button>
        </Alert>
      )}
    </div>
  );
}
