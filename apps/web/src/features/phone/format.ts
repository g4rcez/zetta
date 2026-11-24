/**
 * A number as a person reads it: "+12025550123" as "+1 (202) 555-0123", "+551155550123" as "+55 11 5555-0123". Only the countries the server
 * can call from today get their own shape; any other number is grouped in threes after its country code. Never throws, never loses a digit.
 */
export function formatPhone(e164: string): string {
  const m = /^\+(\d{7,15})$/.exec(e164.trim());
  if (!m) return e164;
  const d = m[1]!;
  if (d.startsWith("1") && d.length === 11)
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const rest = d.slice(4);
    const cut = rest.length - 4;
    return `+55 ${d.slice(2, 4)} ${rest.slice(0, cut)}-${rest.slice(cut)}`;
  }
  const cc = d.length > 10 ? d.slice(0, 2) : d.slice(0, 1);
  const rest = d.slice(cc.length).match(/.{1,3}/g) ?? [];
  return `+${cc} ${rest.join(" ")}`;
}

/** "US" as "United States" (English names; the code itself when the runtime does not know it). */
export function countryName(iso: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}
