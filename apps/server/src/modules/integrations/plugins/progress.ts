/** "10:48", or "1:02:03" past an hour: how long, for a person. */
export function clock(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/**
 * The one line the chat shows for a long call: "Transcribing · 62% · 10:48 of 17:31". The stage comes first; the rest is only what is
 * known (a download has a speed and a time left, a transcription has how much sound is done). Nothing here names a path or an address.
 */
export function formatProgress(p: {
  stage: string;
  percent?: number;
  speed?: string;
  eta?: string;
  doneSeconds?: number;
  totalSeconds?: number;
}) {
  const parts = [p.stage];
  if (p.percent !== undefined) parts.push(`${Math.round(Math.min(100, Math.max(0, p.percent)))}%`);
  if (p.doneSeconds !== undefined)
    parts.push(
      p.totalSeconds
        ? `${clock(p.doneSeconds)} of ${clock(p.totalSeconds)}`
        : `${clock(p.doneSeconds)} done`,
    );
  if (p.speed) parts.push(p.speed);
  if (p.eta && p.eta !== "Unknown") parts.push(`ETA ${p.eta}`);
  return parts.join(" · ");
}
