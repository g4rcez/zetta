import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { layaModelFor } from "@zetta/core/laya-languages";

import { Button, Checkbox } from "@/components/ui";
import { identityClient } from "@/lib/identity-client";
import { errorMessage } from "../chat/chat-client";
import { installationApi, type Installation } from "../onboarding/installation-api";
import { LAYA_LOCALES } from "./laya-locales";
import { LanguagePicker } from "./language-picker";

/** The builtin Laya model setting of this installation; `undefined` while it loads. */
export function useLayaMode(): Installation["laya"] | undefined {
  const [mode, setMode] = useState<Installation["laya"]>();
  useEffect(() => {
    let alive = true;
    void installationApi
      .get()
      .then((i) => alive && setMode(i.laya))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}

/** Shown where a feature needs Laya and the administrator has not turned it on. */
export function LayaOffNote() {
  const mode = useLayaMode();
  if (mode !== "off") return null;
  return (
    <p role="note" className="text-xs text-muted-foreground">
      Laya is off, so this does nothing yet. An administrator can turn it on in{" "}
      <Link to="/studio/$tab" params={{ tab: "decisions" }} className="underline">
        Studio &gt; Decisions
      </Link>
      .
    </p>
  );
}

const sameLanguages = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * The builtin Laya plugin: on or off, and the languages it must understand. English is always on. Any other language
 * selects the multilingual model, so the choice is a draft until the administrator presses the button (the download is 1.3–1.7 GB).
 */
export function LayaSwitch({
  onError,
  onChanged,
  className,
  submitLabel = "Save",
}: {
  onError: (message: string) => void;
  onChanged?: (settings: Installation) => void;
  className?: string;
  /** Label of the button that turns Laya on. */
  submitLabel?: string;
}) {
  const [saved, setSaved] = useState<Installation>();
  const [enabled, setEnabled] = useState(false);
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void installationApi
      .get()
      .then((i) => {
        if (!alive) return;
        setSaved(i);
        setEnabled(i.laya === "on");
        setLanguages(i.layaLanguages);
      })
      .catch(() => undefined);
    void identityClient
      .status()
      .then((s) => alive && setAdmin(s.state === "active" && s.isAdmin))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const isOn = saved?.laya === "on";
  const dirty =
    saved !== undefined && enabled && (!isOn || !sameLanguages(languages, saved.layaLanguages));
  const model = layaModelFor(languages);
  async function save(patch: Partial<Pick<Installation, "laya" | "layaLanguages">>) {
    setBusy(true);
    try {
      const next = await installationApi.patch(patch);
      setSaved(next);
      setEnabled(next.laya === "on");
      setLanguages(next.layaLanguages);
      onChanged?.(next);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function toggle(on: boolean) {
    setEnabled(on);
    // Turning it off frees the memory and costs nothing, so it is saved at once. Turning it on waits for the button.
    if (!on && isOn) void save({ laya: "off" });
  }
  const locked = !admin || busy || saved === undefined;
  return (
    <section
      aria-label="Decision model plugin"
      className={`space-y-3 rounded-xl border bg-card p-5 ${className ?? ""}`}
    >
      <Checkbox checked={enabled} disabled={locked} onChange={(e) => toggle(e.target.checked)}>
        Decision model (Laya)
      </Checkbox>
      <p className="text-sm text-muted-foreground">
        Runs on this server. It is free, and no message leaves the machine. It reads each message
        before the AI to decide how much attention the message needs. It also runs bot decision
        routing and workflow Decide steps.
      </p>
      {enabled && (
        <div className="space-y-3">
          <LanguagePicker
            fixed={["en"]}
            value={languages.filter((t) => t !== "en")}
            onChange={(tags) => setLanguages(["en", ...tags])}
            locales={LAYA_LOCALES}
            disabled={locked}
          />
          <p className="text-xs text-muted-foreground">
            {model === "english"
              ? "English only: the English model, about 1.7 GB to download."
              : "With other languages: the multilingual model, about 1.3 GB to download. It replaces the English model and also reads English. It covers about 50 languages; common languages work best."}{" "}
            Needs about 2 GB of memory.
          </p>
          {dirty && (
            <Button
              type="button"
              size="sm"
              disabled={locked}
              onClick={() => void save({ laya: "on", layaLanguages: languages })}
            >
              {busy ? "Saving…" : isOn ? "Save languages" : submitLabel}
            </Button>
          )}
        </div>
      )}
      {saved !== undefined && !admin && (
        <p className="text-xs text-muted-foreground">Ask your administrator to change this.</p>
      )}
    </section>
  );
}
