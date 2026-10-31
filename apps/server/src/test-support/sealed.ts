import { seal } from "@zetta/core/sealed-transport";
import { transportKeyring } from "../modules/connections/transport";

/** Seals a request payload the way the web app does, to the real process-wide keyring the routes read from. */
export async function sealedFor(userId: string, purpose: string, payload: unknown) {
  const { kid, publicKey } = await transportKeyring.publicKey();
  return seal(publicKey, kid, payload, { userId, purpose });
}
