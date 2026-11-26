/**
 * The `Authentication-Results` header (RFC 8601): `server [version]; method=result type.property=value …; …`.
 *
 * It is parsed, never searched as text: comments and quoted addresses in it hold what the sender wrote, `; dmarc=pass` included.
 */
export type AuthResult = { method: string; result: string; props: Record<string, string> };
export type AuthResults = { server: string; results: AuthResult[] };

type Token = { word: string } | { mark: ";" | "=" };

/** The words and marks of a header value, comments left out. A quoted string stays part of its word. Undefined: never closed. */
function tokens(value: string): Token[] | undefined {
  const out: Token[] = [];
  let word = "";
  let comment = 0;
  let quoted = false;
  const end = () => {
    if (word) out.push({ word });
    word = "";
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && (quoted || comment)) {
      if (quoted) word += value[i + 1] ?? "";
      i++;
    } else if (quoted) {
      if (c === '"') quoted = false;
      else word += c;
    } else if (c === "(") {
      end();
      comment++;
    } else if (comment) {
      if (c === ")") comment--;
    } else if (c === '"') quoted = true;
    else if (c === ";" || c === "=") {
      end();
      out.push({ mark: c });
    } else if (/\s/.test(c)) end();
    else word += c;
  }
  end();
  return quoted || comment ? undefined : out;
}

/** The server and its verdicts, or undefined for a header that cannot be read or names no server. */
export function parseAuthResults(value: string): AuthResults | undefined {
  const all = tokens(value);
  if (!all) return undefined;
  const parts: Token[][] = [[]];
  for (const t of all)
    if ("mark" in t && t.mark === ";") parts.push([]);
    else parts.at(-1)!.push(t);
  const [head, ...rest] = parts;
  const first = head![0];
  // The server's name stands alone (a version number may follow).
  if (!first || !("word" in first) || head!.some((t) => "mark" in t)) return undefined;
  const results: AuthResult[] = [];
  for (const part of rest) {
    const pairs: [string, string][] = [];
    for (let i = 0; i + 2 < part.length;) {
      const [key, eq, val] = part.slice(i, i + 3) as [Token, Token, Token];
      if ("word" in key && "mark" in eq && "word" in val) {
        pairs.push([key.word.toLowerCase(), val.word]);
        i += 3;
      } else i++;
    }
    const [method, ...props] = pairs;
    if (method)
      results.push({
        method: method[0].split("/")[0]!,
        result: method[1].toLowerCase(),
        props: Object.fromEntries(props),
      });
  }
  return { server: first.word.toLowerCase(), results };
}

const domainOf = (value: string | undefined) => value?.split("@").pop()?.toLowerCase();

/**
 * Whether the receiving server vouches that mail comes from `domain` (the From address's): the topmost header with the server's own
 * name says DMARC passed for it, or that a DKIM signature of exactly that domain did. A receiving server puts its header above
 * whatever arrived with the message, so one the sender wrote is below it or carries another name. SPF is not used: it speaks of the
 * envelope's address, not the From line.
 */
export function vouched(headers: readonly string[], server: string, domain: string) {
  const own = headers.map(parseAuthResults).find((h) => h?.server === server.trim().toLowerCase());
  const from = domain.toLowerCase();
  return Boolean(
    own?.results.some(
      (r) =>
        r.result === "pass" &&
        ((r.method === "dmarc" && domainOf(r.props["header.from"]) === from) ||
          (r.method === "dkim" &&
            (domainOf(r.props["header.d"]) === from || domainOf(r.props["header.i"]) === from))),
    ),
  );
}
