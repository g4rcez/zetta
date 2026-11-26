// The kind "vps": everything on one host. Arch Linux, Zetta under systemd, its own Postgres and Caddy for HTTPS, driven over SSH.
import type { InfraKind } from "../core/kind";
import { run, usage } from "./cli";
import type { EnvironmentDefinition } from "./environment";

export { defineEnvironment, type Environment, type EnvironmentDefinition } from "./environment";

export const vps: InfraKind<"vps", EnvironmentDefinition> = {
  id: "vps",
  title: "One Arch Linux server that holds everything: Zetta under systemd, Postgres and Caddy",
  usage,
  run,
};
