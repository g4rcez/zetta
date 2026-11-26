// Files that configure the machine itself.

export const sudoers = (admin: string) => `${admin} ALL=(ALL:ALL) NOPASSWD: ALL
`;

/** Loaded before the distribution's own settings, and the first value wins in sshd. */
export const sshd =
  () => `# Managed by packages/infra: keys only, no root login, no login for the service accounts.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
DenyUsers zetta postgres
X11Forwarding no
`;

/** Filled in on the server with the ports sshd listens on there, which need not be the one you connect to. */
export const SSH_PORTS = "__SSH_PORTS__";

/**
 * Only SSH and the web are reachable. The file replaces its own table and the distribution's default one, and leaves other tables
 * (sshguard's) alone, so a reload never drops the bans.
 */
export const nftables = () => `#!/usr/bin/nft -f
# Managed by packages/infra.
table inet filter
delete table inet filter
table inet zetta
delete table inet zetta

table inet zetta {
	chain input {
		type filter hook input priority filter; policy drop;
		ct state invalid drop
		ct state { established, related } accept
		iif "lo" accept
		meta l4proto { icmp, ipv6-icmp } accept
		udp dport 546 ip6 saddr fe80::/10 accept
		tcp dport { ${SSH_PORTS} } accept
		tcp dport { 80, 443 } accept
		udp dport 443 accept
	}
	chain forward {
		type filter hook forward priority filter; policy drop;
	}
}
`;

export const sshguard = () => `# Managed by packages/infra.
BACKEND="/usr/lib/sshguard/sshg-fw-nft-sets"
LOGREADER="LANG=C /usr/bin/journalctl -afb -p info -n1 -t sshd -t sshd-session -o cat"
THRESHOLD=30
BLOCK_TIME=120
DETECTION_TIME=1800
`;

export const sysctl = () => `vm.swappiness=10
`;

export const journald = () => `[Journal]
SystemMaxUse=500M
`;
