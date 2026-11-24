import type { PluginProgress } from "../integrations/plugins/registry";

/**
 * The callback a plugin call gets to tell the chat how far it is (`PluginContext.progress`). It belongs to one call: once `close` runs
 * (the call returned) nothing more goes out, because a background job keeps reporting for a while and the step it belonged to is over.
 *
 * At most one report a second (the first at once, and the latest of a burst a moment later), never the same text twice, and never an
 * unreasonable size: the chat needs a short line and a percent, not a log.
 */
export function pluginProgressSink(
  emit: (p: PluginProgress) => void,
  o: { everyMs?: number } = {},
) {
  const every = o.everyMs ?? 1000;
  let open = true;
  let last = -Infinity;
  let sent = "";
  let pending: PluginProgress | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (p: PluginProgress) => {
    const key = `${p.text}|${p.percent ?? ""}`;
    if (key === sent) return;
    sent = key;
    last = Date.now();
    emit(p);
  };
  const clean = (p: PluginProgress): PluginProgress => ({
    text: String(p.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
    ...(typeof p.percent === "number" && Number.isFinite(p.percent)
      ? { percent: Math.min(100, Math.max(0, Math.round(p.percent))) }
      : {}),
  });
  return {
    progress(raw: PluginProgress) {
      if (!open) return;
      const p = clean(raw);
      if (!p.text) return;
      const wait = last + every - Date.now();
      if (wait <= 0) {
        pending = undefined;
        send(p);
        return;
      }
      pending = p;
      timer ??= setTimeout(() => {
        timer = undefined;
        const next = pending;
        pending = undefined;
        if (open && next) send(next);
      }, wait);
    },
    close() {
      open = false;
      pending = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
