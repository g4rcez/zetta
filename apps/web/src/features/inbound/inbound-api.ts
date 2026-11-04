import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";

export type InboundFilter = { direct: boolean; groups: boolean; chats: string[] };
export type InboundRoute = {
  id: string;
  botId: string;
  botName: string;
  pluginId: string;
  label: string;
  enabled: boolean;
  filter: InboundFilter;
  pollEverySeconds: number;
  lastPolledAt: string | null;
  lastError: string;
};
export type InboundOption = {
  pluginId: string;
  name: string;
  label: string;
  bound: boolean;
  route: InboundRoute | null;
};

export const inboundApi = {
  forBot: (botId: string) =>
    call<{ available: InboundOption[] }>(`/api/bots/${botId}/inbound`).then((r) => r.available),
  set: (
    botId: string,
    pluginId: string,
    v: { enabled: boolean; filter: InboundFilter; pollEverySeconds?: number },
  ) =>
    call<{ route: InboundRoute }>(`/api/bots/${botId}/inbound/${pluginId}`, "PUT", v).then(
      (r) => r.route,
    ),
  remove: (botId: string, pluginId: string) =>
    call<{ route: InboundRoute }>(`/api/bots/${botId}/inbound/${pluginId}`, "DELETE").then(
      (r) => r.route,
    ),
  pollNow: (routeId: string) =>
    call<{ added: number; route: InboundRoute }>(`/api/inbound/routes/${routeId}/poll`, "POST", {}),
};

export const inboundQueries = {
  forBot: (botId: string) =>
    queryOptions({ queryKey: ["bots", botId, "inbound"], queryFn: () => inboundApi.forBot(botId) }),
};
