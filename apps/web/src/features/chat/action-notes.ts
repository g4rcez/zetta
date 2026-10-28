/** Server action notes ("🔓 Chief updated the permissions of x.") end a bot reply as one-line paragraphs led by an emoji. */
const NOTE = /^(?:🔐|🔓|💾|📘|📝|🖥|🔌|🔑|🔁|✅|🙋|⚠️)️?\s+(\S[^\n]*)$/u;

/** Splits trailing action-note paragraphs off a reply: the prose stays markdown, the notes lose their emoji. */
export function splitActionNotes(text: string): { body: string; notes: string[] } {
  const parts = text.split("\n\n");
  const notes: string[] = [];
  while (parts.length > 1) {
    const m = NOTE.exec(parts[parts.length - 1]!.trim());
    if (!m) break;
    notes.unshift(m[1]!);
    parts.pop();
  }
  const body = parts.join("\n\n");
  // A note-shaped line inside an open code fence is code, not a note.
  return (body.match(/^```/gm)?.length ?? 0) % 2 ? { body: text, notes: [] } : { body, notes };
}
