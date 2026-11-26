// Who may log in to the machine, and how.
import type { Environment } from "../environment";
import { file, quote, step } from "../shell";
import { sshd, sudoers } from "../templates/host";

const KEY =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]+={0,3})(?: .*)?$/;

/** The key without its comment, which often holds a person's address. */
export function publicKeyLine(text: string): string {
  const found = KEY.exec(text.trim());
  if (!found) throw new Error("The SSH public key is not one line of the OpenSSH format.");
  return `${found[1]} ${found[2]} zetta-deploy`;
}

/** Runs first, as root: the admin user must exist and work before root login is closed. */
export const adminUserStep = (environment: Environment, publicKey: string) => {
  const { user } = environment.ssh;
  const key = publicKeyLine(publicKey);
  return step(
    "admin",
    `Admin user "${user}" with your SSH key`,
    `
if ! command -v sudo >/dev/null; then pacman -Syu --needed --noconfirm sudo; changed "installed sudo"; fi
if ! id -u ${user} >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash ${user}
  # "*" means no password, without the lock that some login checks refuse.
  usermod -p '*' ${user}
  changed "user ${user}"
fi
home=$(getent passwd ${user} | cut -d: -f6)
ensure_dir "$home/.ssh" 0700 ${user} "$(id -gn ${user})"
keys="$home/.ssh/authorized_keys"
if ! grep -qF ${quote(key.split(" ")[1]!)} "$keys" 2>/dev/null; then
  printf '%s\\n' ${quote(key)} >>"$keys"
  changed "key added to $keys"
fi
chown ${user}:"$(id -gn ${user})" "$keys"
chmod 600 "$keys"
# Deploys run without a person at the keyboard, so the admin's key is the machine's key: keep it safe.
check=$(mktemp)
printf '%s\\n' ${quote(sudoers(user).trimEnd())} >"$check"
visudo -cqf "$check" || fail "the sudo rule is not valid"
rm -f "$check"
${file({ path: "/etc/sudoers.d/10-zetta-admin", content: sudoers(user), mode: "0440" })}
`,
  );
};

/** Runs only after the admin login was proven to work. */
export const sshdStep = () =>
  step(
    "sshd",
    "SSH: keys only, no root login",
    `
ssh-keygen -A >/dev/null
config=/etc/ssh/sshd_config.d/10-zetta.conf
previous=$(mktemp)
had=0
if [ -f "$config" ]; then cp "$config" "$previous"; had=1; fi
${file({ path: "/etc/ssh/sshd_config.d/10-zetta.conf", content: sshd() })}
# A configuration sshd refuses, or one that an earlier file overrides, is taken back before it can lock anyone out.
undo() {
  if [ "$had" = 1 ]; then cp "$previous" "$config"; else rm -f "$config"; fi
  rm -f "$previous"
  fail "$1"
}
sshd -t || undo "sshd refuses the new configuration"
effective=$(sshd -T)
# Newer OpenSSH prints the names capitalised, older releases in lower case.
grep -qix 'permitrootlogin no' <<<"$effective" || undo "another file keeps root login open (check /etc/ssh/sshd_config)"
grep -qix 'passwordauthentication no' <<<"$effective" || undo "another file keeps password login open (check /etc/ssh/sshd_config)"
rm -f "$previous"
if [ "$WROTE" = 1 ] && systemctl is-active --quiet sshd; then systemctl reload sshd; changed "reloaded sshd"; fi
`,
  );
