// Loaded when a call is made, so a page that only shows the pairing card does not load the auth client (which keeps the `fetch` it finds at load).
const client = () => import("@/lib/auth-client").then((m) => m.authClient);

/** A one-time code from a signed-in browser. It works for 3 minutes, once. */
export async function startPairing() {
  const { data, error } = await (
    await client()
  ).$fetch<{ code: string; expiresAt: string }>("/pair-phone/start", { method: "POST" });
  if (error || !data) throw new Error(error?.message || "Could not make a code. Try again.");
  return data;
}

/** The phone trades the code for a session of its own. */
export async function redeemPairing(code: string) {
  const { error } = await (
    await client()
  ).$fetch("/pair-phone/redeem", {
    method: "POST",
    body: { code },
  });
  if (error) throw new Error(error.message || "This code is not valid anymore.");
}

/** The code travels in the fragment: it never reaches a server log or a Referer header. */
export const pairingLink = (origin: string, code: string) => `${origin}/pair#${code}`;
