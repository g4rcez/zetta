import { Alert } from "@g4rcez/components/alert";
import { ArrowLeftIcon, SparkleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { MentionTextarea } from "../chat/mention";
import { MemberPicker } from "./member-picker";
import {
  BRIEF_FIELDS,
  BRIEF_MAX,
  EMPTY_BRIEF,
  projectsApi,
  projectsQueries,
  type Brief,
  type Candidates,
} from "./projects-api";

const NO_BOTS: Bot[] = [];
const NO_CANDIDATES: Candidates = { bots: [], people: [], rooms: [] };

/**
 * A project in under a minute: its name, one sentence about what is wanted, and who works on it. The sentence can be turned into the four
 * answers of the brief by the person's chief bot; they are a draft to correct, and every one of them may stay empty.
 */
export function NewProjectPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const botList = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const identities = useMemo(() => new Map(botList.map((b) => [b.id, b])), [botList]);
  const candidates = useQuery(projectsQueries.candidates()).data ?? NO_CANDIDATES;
  const [name, setName] = useState("");
  const [sentence, setSentence] = useState("");
  const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF);
  const [bots, setBots] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function draft() {
    if (!name.trim() || !sentence.trim())
      return setNote("Give the project a name and say what you want first.");
    setDrafting(true);
    setNote(undefined);
    try {
      const r = await projectsApi.draft(name.trim(), sentence.trim());
      if (r.kind === "ok") setBrief(r.value);
      else setNote(`${r.reason} You can fill the answers in yourself.`);
    } catch (x) {
      setNote(`${errorMessage(x)} You can fill the answers in yourself.`);
    } finally {
      setDrafting(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the project a name.");
    setBusy(true);
    setError(undefined);
    try {
      // With no answer written, the sentence itself is the outcome: nothing the person typed is lost.
      const answers = brief.outcome.trim() ? brief : { ...brief, outcome: sentence.trim() };
      const made = await projectsApi.create({ name: name.trim(), ...answers, bots, people });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await navigate({ to: "/projects/$projectId", params: { projectId: made.id } });
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="h-full overflow-y-auto">
      <form
        aria-label="New project"
        onSubmit={(e) => void submit(e)}
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-8"
      >
        <Link
          to="/projects"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Projects
        </Link>
        <header>
          <h1 className="text-2xl text-balance">New project</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            Only the name is needed. Everything else can be added or changed later.
          </p>
        </header>
        <Input
          title="Name"
          placeholder="Spring launch"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="space-y-2">
          <MentionTextarea
            title="In one sentence, what do you want?"
            bots={botList}
            rows={2}
            maxLength={BRIEF_MAX}
            placeholder="A launch page and an email that tell our customers about the new plan"
            value={sentence}
            onChange={setSentence}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={drafting}
              onClick={() => void draft()}
            >
              <SparkleIcon aria-hidden="true" className="size-4" />
              {drafting ? "Drafting…" : "Draft the answers for me"}
            </Button>
            <p role="status" className="min-w-0 flex-1 text-sm text-pretty text-muted-foreground">
              {note ?? "Your chief bot fills the four answers below. You correct them."}
            </p>
          </div>
        </div>
        <fieldset className="space-y-4">
          <legend className="mb-2 text-sm font-medium">The brief everyone on it reads</legend>
          {BRIEF_FIELDS.map((f) => (
            <MentionTextarea
              key={f.key}
              title={f.question}
              bots={botList}
              rows={2}
              maxLength={BRIEF_MAX}
              placeholder={f.placeholder}
              value={brief[f.key]}
              onChange={(text) => setBrief((b) => ({ ...b, [f.key]: text }))}
            />
          ))}
        </fieldset>
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Who works on it</h2>
            <p className="text-sm text-pretty text-muted-foreground">
              Bots on the project read the brief before they work. People on it can be asked for
              things and can read this project.
            </p>
          </div>
          <MemberPicker
            candidates={candidates}
            identities={identities}
            bots={bots}
            people={people}
            onBots={setBots}
            onPeople={setPeople}
          />
        </section>
        {error && <Alert theme="danger">{error}</Alert>}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => void navigate({ to: "/projects" })}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </div>
  );
}
