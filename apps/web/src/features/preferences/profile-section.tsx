import { useQueryClient } from "@tanstack/react-query";
import { Alert } from "@g4rcez/components/alert";
import type { AvatarValue } from "@zetta/core/avatar";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AvatarPicker } from "@/components/avatar-picker";
import { UserAvatar } from "@/components/user-avatar";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "../chat/chat-client";
import { profileApi, useProfile } from "./profile-api";
import { Section } from "./section";

/** Name and picture. The email is shown but cannot change here: a new address needs a verification the app does not have. */
export function ProfileSection() {
  const qc = useQueryClient();
  const session = authClient.useSession();
  const profile = useProfile();
  // `undefined` means "not touched": the field follows the saved value until the person edits it.
  const [name, setName] = useState<string>();
  const [avatar, setAvatar] = useState<AvatarValue | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saved = profile.data;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!saved || busy) return;
    const nextName = name?.trim();
    const patch: { name?: string; avatar?: AvatarValue | null } = {
      ...(nextName !== undefined && nextName !== saved.name ? { name: nextName } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    };
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(["profile"], await profileApi.update(patch));
      setName(undefined);
      setAvatar(undefined);
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
  const dirty =
    saved !== undefined &&
    ((name !== undefined && name.trim() !== saved.name) || avatar !== undefined);
  return (
    <Section
      id="profile"
      title="Profile"
      description="Your name and picture, as teammates see them in teams, tasks and discussions."
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
          {error && <Alert theme="danger">{error}</Alert>}
          <Button type="submit" disabled={!dirty || busy || shownName.trim() === ""}>
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </form>
      )}
    </Section>
  );
}
