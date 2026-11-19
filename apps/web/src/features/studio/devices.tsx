import { Desktop } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { BotPicker } from "@/components/bot-picker";
import { Button } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Badge, ConfirmButton } from "../shared/ui";
import { SharedWith } from "./machines";
import { computerQueries, useLoadError, type Device } from "./studio-queries";

const PLATFORM: Record<Device["platform"], string> = {
  darwin: "Mac",
  linux: "Linux",
  win32: "Windows",
};

/**
 * Your own computers that run the Zetta desktop app and are signed in to this server. The app opens the connection (so nothing on your
 * computer is reachable from outside), and the bots you share a computer with can ask it to run a command or list a folder: the person at
 * that computer is asked first, unless they allowed the bot there.
 */
export function DevicesPanel({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: devices, error } = useQuery(computerQueries.devices());
  const { data: bots = [] } = useQuery(chatQueries.bots());
  useLoadError(error, onError);
  const [editing, setEditing] = useState<string>();
  const [draftBots, setDraftBots] = useState<string[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const reload = () => qc.invalidateQueries({ queryKey: computerQueries.devices().queryKey });

  async function saveShare(device: Device) {
    setBusy(device.id);
    try {
      await call(`/api/devices/${device.id}`, "PATCH", { botIds: draftBots });
      setEditing(undefined);
      setNotice(
        draftBots.length
          ? `${device.name} is shared with ${draftBots.length} ${draftBots.length === 1 ? "bot" : "bots"}.`
          : `${device.name} is not shared with any bot.`,
      );
      await reload();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function remove(device: Device) {
    try {
      await call(`/api/devices/${device.id}`, "DELETE");
      setNotice(`${device.name} is no longer paired.`);
      await reload();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  // Nothing paired: stay out of the way. The section appears once a desktop app has signed in and turned sharing on.
  if (!devices?.length) return null;
  return (
    <section className="space-y-3" aria-label="Your computers">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Desktop size={18} aria-hidden />
          Your computers
        </h3>
        <p className="text-xs text-muted-foreground">
          Computers running the Zetta desktop app. A bot you share one with can ask it to run a
          command or list a folder; the person at that computer is asked first.
        </p>
      </div>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <ul className="space-y-3">
        {devices.map((d) => (
          <li key={d.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.name}</span>
              <Badge tone={d.online ? "success" : "neutral"}>
                {d.online ? "Online" : "Offline"}
              </Badge>
              <span className="text-xs text-muted-foreground">{PLATFORM[d.platform]}</span>
              <span className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraftBots(d.botIds);
                    setEditing(editing === d.id ? undefined : d.id);
                  }}
                >
                  Share with bots
                </Button>
                <ConfirmButton
                  label="Remove"
                  question={`Remove ${d.name}? Its pairing is revoked and its connection closes.`}
                  confirmLabel="Remove"
                  onConfirm={() => remove(d)}
                />
              </span>
            </div>
            <SharedWith ids={d.botIds} bots={bots} />
            {editing === d.id && (
              <div className="space-y-3 border-l-2 pl-4">
                <p className="text-xs text-muted-foreground">
                  Only the bots you pick can see or use {d.name}. Everyone else is told it does not
                  exist.
                </p>
                <BotPicker bots={bots} selected={draftBots} onChange={setDraftBots} />
                <Button size="sm" disabled={busy === d.id} onClick={() => void saveShare(d)}>
                  {busy === d.id ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
