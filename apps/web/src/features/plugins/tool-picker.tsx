import { useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { pluginsApi, type ToolAccess } from "./plugins-api";
import { Alert } from "@g4rcez/components/alert";

/** Which tools of one enabled plugin / MCP server this bot may call: all of them, or only the ones ticked. Loads when opened. */
export function ToolPicker({
  botId,
  serverId,
  name,
  disabled = false,
}: {
  botId: string;
  serverId: string;
  name: string;
  disabled?: boolean;
}) {
  const [access, setAccess] = useState<ToolAccess>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function open() {
    if (access) return;
    setError(undefined);
    try {
      setAccess(await pluginsApi.toolAccess(botId, serverId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function save(toolsMode: ToolAccess["toolsMode"], allowedTools: string[]) {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await pluginsApi.setToolAccess(botId, serverId, { toolsMode, allowedTools });
      setAccess((a) => (a ? { ...a, ...saved } : a));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const off = disabled || busy;
  return (
    <details
      className="rounded-lg border bg-card px-3 py-2 text-sm"
      onToggle={(e) => {
        if (e.currentTarget.open) void open();
      }}
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Tools {name} may use
        {access
          ? `: ${access.toolsMode === "all" ? "all" : `${access.allowedTools.length} selected`}`
          : ""}
      </summary>
      <div className="mt-2 space-y-2">
        {error && <Alert theme="danger">{error}</Alert>}
        {!access && !error && <p className="text-xs text-muted-foreground">Loading...</p>}
        {access && (
          <>
            <fieldset className="flex gap-4" disabled={off}>
              <legend className="sr-only">Tool access for {name}</legend>
              {(["all", "selected"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`tools-${serverId}`}
                    className="accent-[var(--primary)]"
                    checked={access.toolsMode === m}
                    onChange={() => void save(m, m === "all" ? [] : access.allowedTools)}
                  />
                  {m === "all" ? "All tools" : "Only selected"}
                </label>
              ))}
            </fieldset>
            {access.toolsMode === "selected" && (
              <ul className="space-y-1">
                {access.tools.map((t) => (
                  <li key={t.name}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 accent-[var(--primary)]"
                        disabled={off}
                        checked={access.allowedTools.includes(t.name)}
                        onChange={(e) =>
                          void save(
                            "selected",
                            e.target.checked
                              ? [...access.allowedTools, t.name]
                              : access.allowedTools.filter((x) => x !== t.name),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{t.name}</span>
                        {t.description && (
                          <span className="line-clamp-2 block text-xs text-muted-foreground">
                            {t.description}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
                {access.tools.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    This server did not list any tools.
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}
