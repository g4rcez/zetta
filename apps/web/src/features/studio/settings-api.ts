import { queryOptions } from "@tanstack/react-query";
import type { SettingGroup } from "@zetta/core/settings";

import { queryClient } from "@/lib/query-client";
import { call } from "../chat/chat-client";

export type SettingValue = string | number | string[];
export type SettingSource = "organization" | "installation" | "imported" | "default";

/** One setting as `GET /api/settings` answers (apps/server/src/modules/settings/service.ts, `SettingView`): the registry entry and where its value stands. */
export type SettingItem = {
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  scope: "installation" | "organization";
  sensitive: boolean;
  type: "switch" | "integer" | "text" | "list" | "choice";
  default: SettingValue;
  /** The value that counts now. */
  value: SettingValue;
  source: SettingSource;
  min?: number;
  max?: number;
  unit?: string;
  maxLength?: number;
  maxItems?: number;
  itemMaxLength?: number;
  options?: string[];
  nonEmpty?: boolean;
};
export type SettingsList = { groups: Record<SettingGroup, string>; settings: SettingItem[] };

const refresh = () => queryClient.invalidateQueries({ queryKey: ["settings"] });
const path = (key: string) => `/api/settings/${encodeURIComponent(key)}`;

export const settingsApi = {
  list: () => call<SettingsList>("/api/settings"),
  save: (key: string, value: SettingValue) =>
    call<SettingItem>(path(key), "PUT", { value }).then(refresh),
  reset: (key: string) => call<SettingItem>(path(key), "DELETE").then(refresh),
};

export const settingsQueries = {
  list: () => queryOptions({ queryKey: ["settings"], queryFn: () => settingsApi.list() }),
};
