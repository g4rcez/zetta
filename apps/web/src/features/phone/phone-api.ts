import { queryOptions } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { call } from "../chat/chat-client";
import type {
  PhoneInboundMode,
  PhoneNumberStatus,
  PhoneOptoutReason,
  PhoneOutboundMode,
  PhoneProviderId,
  PhoneRequestMode,
} from "@zetta/core/phone";

/** What `GET /api/bots/:id/phone` answers (apps/server/src/modules/phone/service.ts, `PhoneNumberView`). Never a PIN or its hash. */
export type BotPhoneNumber = {
  id: string;
  botId: string;
  /** Which provider holds the number. */
  provider: PhoneProviderId;
  number: string | null;
  country: string;
  areaCode: string | null;
  status: PhoneNumberStatus;
  /** A sentence about where the number stands, written by the server. */
  note: string;
  inbound: PhoneInboundMode;
  outbound: PhoneOutboundMode;
  ownerNumber: string | null;
  pinSet: boolean;
  pinLockedUntil: string | null;
  heldUntil: string | null;
  createdAt: string;
};
export type PhoneOffer = {
  on: boolean;
  mode: PhoneRequestMode;
  countries: string[];
  maxNumbers: number;
  /** The providers a number can be asked from. A server older than this page sends none. */
  providers?: { id: PhoneProviderId; countries: string[] }[];
  /** What a request that names no provider uses. */
  defaultProvider?: PhoneProviderId | null;
};
/** A call a bot of this person is placing now (`GET /api/phone/calls/live`). `requestedIn` is the chat that asked for it. */
export type LivePhoneCall = {
  id: string;
  botName: string;
  number: string | null;
  status: "ringing" | "active";
  requestedIn: string | null;
  startedAt: string;
};
export type PhoneAdminNumber = BotPhoneNumber & { ownerUserId: string; botName: string };
/** A bot an administrator may give a number to (`GET /api/phone/bots`). */
export type PhoneAssignableBot = {
  id: string;
  name: string;
  kind: "chief" | "specialist";
  ownerUserId: string;
  ownerName: string;
  /** It has a number or a request now, so it cannot be given a second. */
  hasNumber: boolean;
};
export type PhoneOptout = {
  id: string;
  number: string;
  reason: PhoneOptoutReason;
  createdAt: string;
};

const refresh = () => queryClient.invalidateQueries({ queryKey: ["phone"] });
const path = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/phone`;

export const phoneApi = {
  forBot: (botId: string) =>
    call<{ number: BotPhoneNumber | null; offer: PhoneOffer }>(path(botId)),
  request: (
    botId: string,
    input: { country: string; areaCode?: string | null; provider?: PhoneProviderId },
  ) => call<{ number: BotPhoneNumber }>(path(botId), "POST", input).then(refresh),
  update: (
    botId: string,
    patch: {
      inbound?: PhoneInboundMode;
      outbound?: PhoneOutboundMode;
      ownerNumber?: string | null;
    },
  ) => call<{ number: BotPhoneNumber }>(path(botId), "PATCH", patch).then(refresh),
  setPin: (botId: string, pin: string | null) =>
    call<{ number: BotPhoneNumber }>(`${path(botId)}/pin`, "PUT", { pin }).then(refresh),
  release: (botId: string) => call<{ ok: true }>(path(botId), "DELETE").then(refresh),
  offer: () => call<PhoneOffer>("/api/phone/offer"),
  live: () => call<{ calls: LivePhoneCall[] }>("/api/phone/calls/live").then((r) => r.calls),
  hangUp: (id: string) =>
    call<{ ok: true }>(`/api/phone/calls/${encodeURIComponent(id)}/hangup`, "POST", {}),
  numbers: () => call<{ numbers: PhoneAdminNumber[] }>("/api/phone/numbers"),
  approve: (id: string) =>
    call<unknown>(`/api/phone/numbers/${id}/approve`, "POST", {}).then(refresh),
  reject: (id: string) =>
    call<unknown>(`/api/phone/numbers/${id}/reject`, "POST", {}).then(refresh),
  operatorRelease: (id: string) =>
    call<unknown>(`/api/phone/numbers/${id}/release`, "POST", {}).then(refresh),
  attach: (input: { botId: string; number: string; provider?: PhoneProviderId }) =>
    call<{ number: PhoneAdminNumber }>("/api/phone/numbers/attach", "POST", input).then(refresh),
  reassign: (id: string, botId: string) =>
    call<unknown>(`/api/phone/numbers/${id}/reassign`, "POST", { botId }).then(refresh),
  bots: () => call<{ bots: PhoneAssignableBot[] }>("/api/phone/bots"),
  optouts: () => call<{ optouts: PhoneOptout[] }>("/api/phone/optouts"),
  addOptout: (number: string) =>
    call<unknown>("/api/phone/optouts", "POST", { number }).then(refresh),
  removeOptout: (id: string) => call<unknown>(`/api/phone/optouts/${id}`, "DELETE").then(refresh),
};

export const phoneQueries = {
  offer: () =>
    queryOptions({
      queryKey: ["phone", "offer"],
      queryFn: () => phoneApi.offer(),
      staleTime: 5 * 60_000,
    }),
  live: () => queryOptions({ queryKey: ["phone", "live"], queryFn: () => phoneApi.live() }),
  forBot: (botId: string) =>
    queryOptions({ queryKey: ["phone", "bot", botId], queryFn: () => phoneApi.forBot(botId) }),
  numbers: () =>
    queryOptions({ queryKey: ["phone", "numbers"], queryFn: () => phoneApi.numbers() }),
  bots: () => queryOptions({ queryKey: ["phone", "bots"], queryFn: () => phoneApi.bots() }),
  optouts: () =>
    queryOptions({ queryKey: ["phone", "optouts"], queryFn: () => phoneApi.optouts() }),
};
