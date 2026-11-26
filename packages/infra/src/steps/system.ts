// The operating system under Zetta: packages, swap, time, logs and the firewall.
import type { Environment } from "../environment";
import { step, trackedFile } from "../shell";
import { journald, nftables, SSH_PORTS, sshguard, sysctl } from "../templates/host";

/** Exit status of the package step when the running kernel's modules are gone and the machine must restart. */
export const REBOOT_REQUIRED = 75;

export function packages(environment: Environment): string[] {
  const list = [
    "openssh",
    "git",
    "github-cli",
    "curl",
    "rsync",
    "unzip",
    "openssl",
    // Turns the voice notes people send into audio the speech model reads.
    "ffmpeg",
    "postgresql",
    "pgvector",
    "caddy",
    "nftables",
    "sshguard",
  ];
  if (environment.agents.length) list.push("nodejs", "npm");
  if (environment.sandbox === "podman") list.push("podman", "passt");
  return list;
}

export const packagesStep = (environment: Environment) =>
  step(
    "packages",
    "System packages",
    `
mapfile -t missing < <(pacman -T ${packages(environment).join(" ")} || true)
if [ "\${#missing[@]}" -gt 0 ]; then
  # Arch supports no partial upgrade: installing anything upgrades the whole system with it.
  pacman -Syu --needed --noconfirm "\${missing[@]}"
  changed "installed \${missing[*]}"
fi
if ! systemd-detect-virt --quiet --container && [ ! -d "/usr/lib/modules/$(uname -r)" ]; then
  note "The kernel was upgraded. Restart the server, then run bootstrap again."
  exit ${REBOOT_REQUIRED}
fi
`,
  );

export const hostStep = (environment: Environment) => {
  const size = environment.swapGiB;
  const swap = size
    ? `
if ! systemd-detect-virt --quiet --container; then
  if [ -z "$(swapon --show --noheadings)" ]; then
    if [ ! -f /swapfile ]; then
      if [ "$(findmnt -no FSTYPE /)" = btrfs ]; then
        btrfs filesystem mkswapfile --size ${size}G /swapfile
      else
        fallocate -l ${size}G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
      fi
    fi
    swapon /swapfile
    changed "swap on /swapfile"
  fi
  if [ -f /swapfile ] && ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
    printf '\\n/swapfile none swap defaults 0 0\\n' >>/etc/fstab
    changed "/etc/fstab"
  fi
fi`
    : "";
  return step(
    "host",
    "Swap, clock and logs",
    `${swap}
SYSCTL=0
${trackedFile("SYSCTL", { path: "/etc/sysctl.d/90-zetta.conf", content: sysctl() })}
if [ "$SYSCTL" = 1 ] && ! systemd-detect-virt --quiet --container; then sysctl -q --system; fi
JOURNAL=0
${trackedFile("JOURNAL", { path: "/etc/systemd/journald.conf.d/zetta.conf", content: journald() })}
if [ "$JOURNAL" = 1 ]; then systemctl restart systemd-journald; fi
if ! systemd-detect-virt --quiet --container; then ensure_running systemd-timesyncd; fi
`,
  );
};

export const firewallStep = () =>
  step(
    "firewall",
    "Firewall: SSH, 80 and 443 only",
    `
# The server's own answer, so a port forwarded in front of it can never lock you out.
ports=$(sshd -T | awk 'tolower($1) == "port" { print $2 } tolower($1) == "listenaddress" { n = split($2, part, ":"); print part[n] }' | sort -un | paste -sd, -)
[ -n "$ports" ] || fail "cannot tell which port sshd listens on"
rules=$(mktemp)
sed "s/${SSH_PORTS}/$ports/" >"$rules" <<'__RULES__'
${nftables().trimEnd()}
__RULES__
nft --check --file "$rules" || fail "the firewall rules are not valid"
put_file /etc/nftables.conf 0755 root root <"$rules"
FIREWALL=$WROTE
rm -f "$rules"
if ! systemctl is-enabled --quiet nftables; then systemctl enable --quiet nftables; changed "enabled nftables"; fi
# The unit loads the rules and exits, so "active" says nothing: the loaded table does.
if [ "$FIREWALL" = 1 ] || ! nft list table inet zetta >/dev/null 2>&1; then
  nft --file /etc/nftables.conf
  changed "firewall loaded (SSH on $ports)"
fi
GUARD=0
${trackedFile("GUARD", { path: "/etc/sshguard.conf", content: sshguard() })}
if [ "$GUARD" = 1 ] && systemctl is-active --quiet sshguard; then systemctl restart sshguard; fi
ensure_running sshguard
`,
  );
