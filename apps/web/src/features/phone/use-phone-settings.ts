import type { PhoneProviderId } from "@zetta/core/phone";
import { useState } from "react";

import { queryClient } from "@/lib/query-client";
import { errorMessage } from "../chat/chat-client";
import {
  installationApi,
  type Installation,
  type PhoneSettingsPatch,
  type PhoneTest,
} from "../onboarding/installation-api";
import {
  CARD_FIELDS,
  accessPatch,
  changedFields,
  isOn,
  isProblem,
  keyStateOf,
  limitsPatch,
  providerPatch,
  viewOf,
  type Area,
  type Drafts,
  type Note,
  type PhoneView,
  type TestVerdict,
} from "./phone-settings-model";

/** What the page asks of the server. Keys are sealed in the browser by the installation api; the page never sends one in the open. */
export type PhoneSetupApi = {
  patch: (patch: PhoneSettingsPatch) => Promise<unknown>;
  saveKey: (id: PhoneProviderId, secret: string) => Promise<unknown>;
  removeKey: (id: PhoneProviderId) => Promise<unknown>;
  test: (id: PhoneProviderId) => Promise<PhoneTest>;
};

/** What the page and the bots' offer show depends on these settings: read them again after a change. */
const refreshOffer = () => queryClient.invalidateQueries({ queryKey: ["phone"] });

export const phoneSetupApi: PhoneSetupApi = {
  patch: (patch) => installationApi.patch(patch).then(refreshOffer),
  saveKey: (id, secret) =>
    id === "telnyx"
      ? installationApi.savePhoneKey(secret)
      : installationApi.savePhoneTwilioKey(secret),
  removeKey: (id) =>
    (id === "telnyx"
      ? installationApi.removePhoneKey()
      : installationApi.removePhoneTwilioKey()
    ).then(refreshOffer),
  test: (id) => installationApi.testPhone(id),
};

/** What is running: one thing at a time. */
export type Busy =
  | "idle"
  | `save:${Area}`
  | `disconnect:${PhoneProviderId}`
  | `test:${PhoneProviderId}`;
/** How a card's save ended, so the card can fold itself. */
export type SaveResult = "saved" | "refused";

type Secrets = Record<PhoneProviderId, string>;
type Tests = Partial<Record<PhoneProviderId, PhoneTest>>;
type Notes = Partial<Record<Area, Note>>;

export type PhoneSettingsState = {
  view: PhoneView;
  busy: Busy;
  secrets: Secrets;
  notes: Notes;
  tests: Tests;
  /** What the last Test of a provider said. */
  verdict: (id: PhoneProviderId) => TestVerdict;
  /** A card has something typed that is not saved: its own fields, the shared address, or a key. */
  dirty: (id: PhoneProviderId) => "clean" | "dirty";
  accessDirty: "clean" | "dirty";
  limitsDirty: "clean" | "dirty";
  edit: (patch: Drafts) => void;
  setSecret: (id: PhoneProviderId, value: string) => void;
  saveProvider: (id: PhoneProviderId) => Promise<SaveResult>;
  disconnect: (id: PhoneProviderId) => Promise<SaveResult>;
  test: (id: PhoneProviderId) => Promise<void>;
  saveAccess: () => Promise<SaveResult>;
  saveLimits: () => Promise<SaveResult>;
};

const ACCESS_FIELDS: (keyof PhoneView)[] = ["mode", "countries", "defaultProvider"];
const LIMIT_FIELDS: (keyof PhoneView)[] = [
  "maxNumbers",
  "maxCallMinutes",
  "dailyMinutes",
  "dailyCalls",
];

/** Drop the drafts of the given fields: they were saved. */
function without(drafts: Drafts, fields: readonly (keyof PhoneView)[]): Drafts {
  const next: Record<string, unknown> = { ...drafts };
  for (const f of fields) delete next[f];
  return next as Drafts;
}

/**
 * The state of the phone setup: what is typed and not saved (`Drafts`), the keys being typed, what the last Test said and which
 * sentence belongs to which part. A draft is dropped only when its own part is saved, so saving a key, or one card, never wipes what
 * is typed elsewhere. The public address is one value shared by both cards.
 */
export function usePhoneSettings(saved: Installation, api: PhoneSetupApi): PhoneSettingsState {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [secrets, setSecrets] = useState<Secrets>({ telnyx: "", twilio: "" });
  const [busy, setBusy] = useState<Busy>("idle");
  const [notes, setNotes] = useState<Notes>({});
  const [tests, setTests] = useState<Tests>({});
  const view = viewOf(saved, drafts);
  const changed = changedFields(saved, drafts);
  const bothOn = isOn(saved, "telnyx") && isOn(saved, "twilio");

  const say = (area: Area, note: Note) => setNotes((n) => ({ ...n, [area]: note }));
  const refuse = (area: Area, problem: { field: Note["field"]; text: string }): SaveResult => {
    say(area, { kind: "error", ...problem });
    return "refused";
  };

  /** One piece of work at a time, with its error shown in its own part. */
  async function work(
    what: Busy,
    area: Area,
    job: () => Promise<void>,
    ok: string,
  ): Promise<SaveResult> {
    setBusy(what);
    setNotes((n) => ({ ...n, [area]: undefined }));
    try {
      await job();
      say(area, { kind: "ok", field: "form", text: ok });
      return "saved";
    } catch (e) {
      return refuse(area, { field: "form", text: errorMessage(e) });
    } finally {
      setBusy("idle");
    }
  }

  return {
    view,
    busy,
    secrets,
    notes,
    tests,
    verdict: (id) => (tests[id] === undefined ? "untested" : tests[id]!.ok ? "passed" : "failed"),
    dirty: (id) =>
      secrets[id] !== "" || CARD_FIELDS[id].some((f) => changed.includes(f)) ? "dirty" : "clean",
    accessDirty: ACCESS_FIELDS.some((f) => changed.includes(f)) ? "dirty" : "clean",
    limitsDirty: LIMIT_FIELDS.some((f) => changed.includes(f)) ? "dirty" : "clean",
    edit: (patch) => {
      setNotes({});
      setDrafts((d) => ({ ...d, ...patch }));
    },
    setSecret: (id, value) => {
      setNotes({});
      setSecrets((s) => ({ ...s, [id]: value }));
    },
    saveProvider: async (id) => {
      const secret = secrets[id];
      const patch = providerPatch(id, { view, keyState: keyStateOf(saved, id), secret });
      if (isProblem(patch)) return refuse(id, patch);
      const result = await work(
        `save:${id}`,
        id,
        async () => {
          if (secret) {
            // The field is emptied at once: the page never keeps a key it sent.
            setSecrets((s) => ({ ...s, [id]: "" }));
            await api.saveKey(id, secret);
          }
          await api.patch(patch);
          setDrafts((d) => without(d, CARD_FIELDS[id]));
          setTests((t) => ({ ...t, [id]: undefined }));
        },
        "Saved.",
      );
      return result;
    },
    disconnect: async (id) => {
      const other: PhoneProviderId = id === "telnyx" ? "twilio" : "telnyx";
      const off: PhoneSettingsPatch =
        id === "telnyx" ? { phoneProvider: "off" } : { phoneTwilio: "off" };
      if (isOn(saved, other)) off.phoneDefaultProvider = other;
      return work(
        `disconnect:${id}`,
        id,
        async () => {
          await api.patch(off);
          await api.removeKey(id);
          setSecrets((s) => ({ ...s, [id]: "" }));
          setTests((t) => ({ ...t, [id]: undefined }));
        },
        "Disconnected.",
      );
    },
    test: async (id) => {
      setBusy(`test:${id}`);
      setNotes((n) => ({ ...n, [id]: undefined }));
      try {
        const r = await api.test(id);
        setTests((t) => ({ ...t, [id]: r }));
      } catch (e) {
        setTests((t) => ({ ...t, [id]: { ok: false, message: errorMessage(e) } }));
      } finally {
        setBusy("idle");
      }
    },
    saveAccess: () =>
      work(
        "save:access",
        "access",
        async () => {
          await api.patch(accessPatch(view, bothOn));
          setDrafts((d) => without(d, ACCESS_FIELDS));
        },
        "Saved.",
      ),
    saveLimits: async () => {
      const patch = limitsPatch(view);
      if (isProblem(patch)) return refuse("limits", patch);
      return work(
        "save:limits",
        "limits",
        async () => {
          await api.patch(patch);
          setDrafts((d) => without(d, LIMIT_FIELDS));
        },
        "Saved.",
      );
    },
  };
}
