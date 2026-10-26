// Runs user-supplied regular expressions off the main thread so a catastrophic pattern can be killed by a timeout.
declare const self: Worker;
self.onmessage = (e: MessageEvent<{ id: number; op: "replace" | "test"; pattern: string; text: string; replacement?: string }>) => {
  const { id, op, pattern, text, replacement } = e.data;
  try {
    const re = new RegExp(pattern, "gi");
    self.postMessage({ id, ok: true, value: op === "replace" ? text.replace(re, replacement ?? "") : re.test(text) });
  } catch { self.postMessage({ id, ok: false }); }
};
