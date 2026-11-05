import { SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui";
import { call, errorMessage } from "../chat/chat-client";
import { Response } from "../chat/response";
import { Badge } from "../shared/ui";
import { contentFields } from "./item-fields";
import { RELATION, type Ask, type AssistResult, type AssistSuggestions } from "./memory-api";
import { appendLink } from "./memory-links";

const LABEL: Record<Ask, string> = {
  tags: "Suggest tags",
  howto: "Write the how-to",
  score: "Suggest a score",
  links: "Suggest links",
  tidy: "Tidy the content",
};

/** Puts a value into a field of the editor form as if it was typed, so the form knows it has unsaved changes. */
function setField(form: HTMLFormElement | null, name: string, value: string) {
  const el = form?.elements.namedItem(name);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/**
 * Help for the editor. It reads what is in the form now, asks for one kind of suggestion, and shows it as a card: nothing changes
 * until the person accepts it, and nothing is saved until they save.
 */
export function AssistPanel({
  form,
  slug,
  autoAsk,
}: {
  form: RefObject<HTMLFormElement | null>;
  slug: string | undefined;
  autoAsk?: "links" | "tags" | "tidy" | undefined;
}) {
  const [working, setWorking] = useState<Ask>();
  const [got, setGot] = useState<AssistSuggestions>({});
  const [error, setError] = useState<string>();
  const turn = useRef(0); // Cancel and a newer request make an older answer arrive for nobody

  const ask = async (kind: Ask) => {
    const f = form.current;
    if (!f) return;
    const draft = contentFields(new FormData(f));
    const mine = ++turn.current;
    setWorking(kind);
    setError(undefined);
    try {
      const r = await call<AssistResult>("/api/memory-assist", "POST", {
        ...(slug && { slug }),
        draft,
        ask: [kind],
      });
      if (mine !== turn.current) return;
      if (r.kind === "unavailable") setError(r.reason);
      else {
        const none = Object.keys(r.suggestions).length === 0;
        if (none) setError("No suggestion this time. Try again, or add more to the content first.");
        setGot((g) => ({ ...g, ...r.suggestions }));
      }
    } catch (e) {
      if (mine === turn.current) setError(errorMessage(e));
    } finally {
      if (mine === turn.current) setWorking(undefined);
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (autoAsk && !started.current) {
      started.current = true;
      void ask(autoAsk);
    }
    // Runs once, when the page opens with ?assist=…
  }, []);
  const drop = (k: keyof AssistSuggestions) => setGot((g) => ({ ...g, [k]: undefined }));
  const tagsNow = () =>
    String((form.current?.elements.namedItem("tags") as HTMLInputElement | null)?.value ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  return (
    <section
      aria-label="Help with this item"
      className="space-y-3 rounded-lg border border-dashed p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm font-medium">
          <SparkleIcon aria-hidden="true" /> Help me
        </span>
        {(Object.keys(LABEL) as Ask[]).map((k) => (
          <Button
            key={k}
            type="button"
            size="xs"
            variant="outline"
            disabled={working !== undefined}
            onClick={() => void ask(k)}
          >
            {LABEL[k]}
          </Button>
        ))}
        {working && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              turn.current++;
              setWorking(undefined);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      <div aria-live="polite" aria-busy={working !== undefined} className="space-y-2">
        {working && (
          <p className="text-xs text-muted-foreground">Working on it… this can take a minute.</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {got.tags && got.tags.length > 0 && (
          <Card
            title="Tags"
            onReject={() => drop("tags")}
            onAccept={() => {
              setField(form.current, "tags", [...new Set([...tagsNow(), ...got.tags!])].join(", "));
              drop("tags");
            }}
          >
            <span className="flex flex-wrap gap-1">
              {got.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </span>
          </Card>
        )}
        {got.howto && (
          <Card
            title="How to use it"
            onReject={() => drop("howto")}
            onAccept={() => {
              setField(form.current, "howto", got.howto!);
              drop("howto");
            }}
          >
            {got.howto}
          </Card>
        )}
        {got.score && (
          <Card
            title={`Score ${got.score.value} / 100`}
            onReject={() => drop("score")}
            onAccept={() => {
              // A shared item has no score field in the form: the suggestion stays visible with a hint then.
              if (setField(form.current, "score", String(got.score!.value))) drop("score");
              else setError("This item's score cannot be changed here.");
            }}
          >
            {got.score.reason}
          </Card>
        )}
        {got.links?.map((l) => (
          <Card
            key={`${l.relation}:${l.slug}`}
            title={`${RELATION[l.relation]} “${l.title}”`}
            onReject={() => setGot((g) => ({ ...g, links: g.links?.filter((x) => x !== l) }))}
            onAccept={() => {
              const text =
                (form.current?.elements.namedItem("content") as HTMLTextAreaElement | null)
                  ?.value ?? "";
              setField(form.current, "content", appendLink(text, l.relation, l.slug));
              setGot((g) => ({ ...g, links: g.links?.filter((x) => x !== l) }));
            }}
          >
            {l.reason}
          </Card>
        ))}
        {got.tidy && (
          <Card
            title="Tidied content"
            onReject={() => drop("tidy")}
            onAccept={() => {
              setField(form.current, "content", got.tidy!.content);
              drop("tidy");
            }}
          >
            <p className="mb-2 text-muted-foreground">{got.tidy.summary}</p>
            <div className="max-h-64 overflow-y-auto rounded-md border bg-background p-3">
              <Response text={got.tidy.content} />
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}

function Card({
  title,
  children,
  onAccept,
  onReject,
}: {
  title: string;
  children: React.ReactNode;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 text-sm">
      <p className="font-medium">{title}</p>
      <div>{children}</div>
      <div className="flex gap-2">
        <Button type="button" size="xs" onClick={onAccept}>
          Accept
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={onReject}>
          Reject
        </Button>
      </div>
    </div>
  );
}
