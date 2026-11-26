// The order of a bootstrap. The admin user and sshd come apart from the rest: the CLI proves the admin login between them.
import type { Environment } from "../environment";
import type { Step } from "../shell";
import type { Versions } from "../versions";
import { appUserStep, caddyStep, servicesStep } from "./app";
import { postgresStep } from "./database";
import { agentsStep, bunStep, podmanStep } from "./runtime";
import { firewallStep, hostStep, packagesStep } from "./system";

export { adminUserStep, sshdStep } from "./access";
export { REBOOT_REQUIRED } from "./system";

export function hostSteps(environment: Environment, versions: Versions): Step[] {
  return [
    packagesStep(environment),
    hostStep(environment),
    firewallStep(),
    bunStep(versions),
    postgresStep(environment),
    appUserStep(environment),
    ...(environment.agents.length ? [agentsStep(environment, versions)] : []),
    ...(environment.sandbox === "podman" ? [podmanStep(versions)] : []),
    caddyStep(environment),
    servicesStep(environment),
  ];
}
