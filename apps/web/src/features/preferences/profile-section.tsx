import { useQueryClient } from "@tanstack/react-query";
import { Alert } from "@g4rcez/components/alert";
import type { AvatarValue } from "@zetta/core/avatar";
import {
  browserTimeZone,
  PROFILE_LIMITS,
  type ProfileLines,
  type ProfileTextField,
} from "@zetta/core/person-profile";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "@/lib/notify";

import { AvatarPicker } from "@/components/avatar-picker";
import { EditorField } from "@/components/editor/editor";
import { UserAvatar } from "@/components/user-avatar";
import { Button, Input, Select } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "../chat/chat-client";
import { profileApi, useProfile, type ProfilePatch } from "./profile-api";
import { Section } from "./section";

/** The short lines of the profile, in the order of the form. `about` has its own multi-line field. */
const SHORT_LINES: {
  key: Exclude<ProfileTextField, "about">;
  title: string;
  placeholder: string;
}[] = [
  { key: "jobTitle", title: "Job title", placeholder: "Head of design" },
  { key: "department", title: "Department", placeholder: "Product" },
  { key: "contact", title: "Contact", placeholder: "Phone, handle or how to reach you" },
];

/** Every IANA zone this browser knows. A browser without the list offers only the zone that is saved. */
function knownZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/**
 * The time zone line. Until the person changes it, the browser's zone is the answer and nothing is saved: the line says so, with a
 * Change control. Choosing "This device" in the list saves an empty value again.
 */
function TimeZoneField({
  saved,
  value,
  onChange,
}: {
  /** The zone that is saved ("" = the device's). */
  saved: string;
  /** The zone shown now: the saved one, or what the person chose and did not save yet. */
  value: string;
  onChange: (zone: string) => void;
}) {
  const device = useMemo(browserTimeZone, []);
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const zones = knownZones();
    const known = new Set(zones);
    const extra = [saved, value].filter((z) => z && !known.has(z));
    return [
      { value: "", label: `This device (${device})` },
      ...[...extra, ...zones].map((z) => ({ value: z, label: z.replaceAll("_", " ") })),
    ];
  }, [device, saved, value]);
  if (!open)
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">Time zone</p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span>{value || device}</span>
          <span className="text-muted-foreground">{value ? "chosen by you" : "this device"}</span>
          <Button type="button" variant="link" size="xs" onClick={() => setOpen(true)}>
            Change
          </Button>
        </p>
      </div>
    );
  return (
    <Select
      title="Time zone"
      name="timezone"
      required={false}
      value={value}
      options={options}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Name, picture and the lines a person writes about themselves. The email is shown but cannot change here: a new address needs a verification the app does not have. */
export function ProfileSection() {
  const qc = useQueryClient();
  const session = authClient.useSession();
  const profile = useProfile();
  // `undefined` means "not touched": the field follows the saved value until the person edits it.
  const [name, setName] = useState<string>();
  const [avatar, setAvatar] = useState<AvatarValue | null>();
  const [lines, setLines] = useState<Partial<ProfileLines>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saved = profile.data;

  const edit = (key: keyof ProfileLines, value: string) =>
    setLines((prev) => ({ ...prev, [key]: value }));
  /** The fields whose draft differs from the saved value. Only these are sent. */
  const changedLines = (): Partial<ProfileLines> =>
    saved
      ? Object.fromEntries(
          (Object.keys(lines) as (keyof ProfileLines)[])
            .filter((k) => lines[k] !== undefined && lines[k]!.trim() !== (saved[k] ?? ""))
            .map((k) => [k, lines[k]!.trim()]),
        )
      : {};

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!saved || busy) return;
    const nextName = name?.trim();
    const patch: ProfilePatch = {
      ...(nextName !== undefined && nextName !== saved.name ? { name: nextName } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
      ...changedLines(),
    };
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(["profile"], await profileApi.update(patch));
      // What other pages show about this person (teams, tasks, the People page) comes from the members list.
      void qc.invalidateQueries({ queryKey: ["people"] });
      setName(undefined);
      setAvatar(undefined);
      setLines({});
      await session.refetch();
      toast.success("Profile saved.");
    } catch (err) {
      setError(errorMessage(err, "Could not save your profile."));
    } finally {
      setBusy(false);
    }
  }

  const shownName = name ?? saved?.name ?? "";
  const shownAvatar = avatar === undefined ? (saved?.avatar ?? null) : avatar;
  const shown = (key: keyof ProfileLines) => lines[key] ?? saved?.[key] ?? "";
  const dirty =
    saved !== undefined &&
    ((name !== undefined && name.trim() !== saved.name) ||
      avatar !== undefined ||
      Object.keys(changedLines()).length > 0);
  return (
    <Section
      id="profile"
      title="Profile"
      description="Your name, picture and a few lines about you, as teammates see them in teams, tasks and discussions. Bots read your job title with your name."
    >
      {profile.isError ? (
        <Alert theme="danger">{errorMessage(profile.error, "Could not load your profile.")}</Alert>
      ) : !saved ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <form onSubmit={(e) => void save(e)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              title="Name"
              name="name"
              required
              maxLength={80}
              autoComplete="name"
              value={shownName}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="space-y-1">
              <Input title="Email" name="email" readOnly value={saved.email} />
              <p className="text-xs text-muted-foreground">Email can't be changed here.</p>
            </div>
          </div>
          <AvatarPicker
            id={saved.email}
            value={shownAvatar}
            onChange={setAvatar}
            none={{
              label: "Initial",
              title: "Initial of your name",
              preview: <UserAvatar name={shownName || "?"} size={44} />,
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {SHORT_LINES.map((l) => (
              <Input
                key={l.key}
                title={l.title}
                name={l.key}
                required={false}
                maxLength={PROFILE_LIMITS[l.key]}
                placeholder={l.placeholder}
                value={shown(l.key)}
                onChange={(e) => edit(l.key, e.target.value)}
              />
            ))}
            <TimeZoneField
              saved={saved.timezone ?? ""}
              value={shown("timezone")}
              onChange={(zone) => edit("timezone", zone)}
            />
          </div>
          {/* Plain on purpose: a short text about a person that others read as it is; an @ mention would turn into a bot link here. */}
          <EditorField
            title="About you"
            name="about"
            rows={3}
            maxLength={PROFILE_LIMITS.about}
            value={shown("about")}
            onChange={(text) => edit("about", text)}
            placeholder="What you work on, and how teammates and bots can best work with you."
          />
          {error && <Alert theme="danger">{error}</Alert>}
          <Button type="submit" disabled={!dirty || busy || shownName.trim() === ""}>
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </form>
      )}
    </Section>
  );
}
