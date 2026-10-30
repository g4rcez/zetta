import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

import { ApiError, chatClient, errorMessage, type SnapshotPreview } from "./chat-client";
import { Markdown } from "./markdown";
import { Modal } from "../shared/ui";

/** Two-step publish: shows the exact text the team will see, then confirms using the preview hash. */
export function PublishDialog({
  conversationId,
  onClose,
  onPublished,
}: {
  conversationId: string;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [preview, setPreview] = useState<SnapshotPreview>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setPreview(undefined);
    chatClient.previewSnapshot(conversationId).then(
      (p) => {
        setPreview(p);
        setError(undefined);
      },
      (e) => setError(errorMessage(e)),
    );
  }, [conversationId]);
  useEffect(load, [load]);
  async function confirm() {
    if (!preview || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await chatClient.publishSnapshot(conversationId, preview.previewHash);
      onPublished();
    } catch (e) {
      if (e instanceof ApiError && e.code === "PREVIEW_MISMATCH") {
        setNote(
          "The conversation changed since you opened this preview. Review the updated text before publishing.",
        );
        load();
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Publish a read-only copy to your team" onClose={onClose}>
      <p className="rounded-lg border border-warn/50 p-2">
        This exact text will be visible to your team. Messages sent after you confirm are not
        included, and you can take the copy down later.
      </p>
      {note && (
        <p role="status" className="text-sm">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!preview && !error && <p role="status">Preparing the preview…</p>}
      {preview && (
        <div className="space-y-2">
          <p className="font-medium">
            {preview.title}{" "}
            <span className="font-normal text-muted-foreground">· with {preview.botName}</span>
          </p>
          <ol
            className="max-h-[40dvh] space-y-2 overflow-y-auto rounded-md border bg-card p-3"
            aria-label="Text that will be published"
          >
            {preview.parts.map((p) => (
              <li key={p.seq} className="min-w-0 text-sm">
                <p className="text-xs font-semibold">
                  #{p.seq} {p.role === "user" ? "You" : (p.author ?? "Bot")}
                  {p.thread ? ` · ↳ reply to #${p.thread}` : ""}
                </p>
                <div className="min-w-0 break-words">
                  <Markdown source={p.content} />
                </div>
                {p.attachments?.length ? (
                  <p className="text-xs text-muted-foreground">
                    Attached files (names only): {p.attachments.join(", ")}
                  </p>
                ) : null}
                {p.reactions && Object.keys(p.reactions).length ? (
                  <p className="text-xs">
                    {Object.entries(p.reactions)
                      .map(([e, n]) => `${e} ${n}`)
                      .join("  ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!preview || busy} onClick={() => void confirm()}>
          {busy ? "Publishing…" : "Publish this text"}
        </Button>
      </div>
    </Modal>
  );
}
