/** Splits text into pieces of about `size` characters, cut at a paragraph or sentence end when one is near, with a short overlap. */
export function chunkText(text: string, size = 1500, overlap = 150): string[] {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      // Prefer a paragraph break, then a sentence end, in the last third of the window.
      const floor = start + Math.floor(size * (2 / 3));
      const window = clean.slice(floor, end);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
        window.lastIndexOf("\n"),
      );
      const cut = para >= 0 ? para + 2 : sentence >= 0 ? sentence + 2 : -1;
      if (cut > 0) end = floor + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}
