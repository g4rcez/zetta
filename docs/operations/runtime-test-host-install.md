# Dedicated test VM software proposal

Status: exact installation approved by user2026-10-22 (“Approve the pinned test VM installation”) and completed with matching readback. Applies only to `zetta-v1-runtime`, VM ID `1FB29298-C5D4-4056-AC29-A174E1A43F50`.

The approved VM is installed and its read-only inventory passed: Pop!_OS24.04/aarch64, systemd255, ext4, cgroupv2 with CPU/memory/PID controllers, guest agent and administrator execution available. Bun and Docker are absent. Network interface is down; sharing/clipboard/microphone remain disabled. VMPal's64GB host allocation limit differs from the guest's sparse virtual filesystem capacity; no64GB guest filesystem claim is made.

## Exact proposed additions

| Artifact              | Version / size                          | SHA256                                                           |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| Bun Linux aarch64 zip | 1.3.14 /35700603 bytes                  | a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b |
| docker.io arm64 deb   | 29.1.3-0ubuntu3~24.04.2 /32026672 bytes | fb0b4f8f4738d3d610b511f50808abd49376ee715a81364e7dbd8a2c60c580d6 |
| containerd arm64 deb  | 2.2.1-0ubuntu1~24.04.4 /25161630 bytes  | c5639c3caf03800717867c45580b93a2db54465c5c1d861aac82d875fe286824 |
| runc arm64 deb        | 1.3.4-0ubuntu1~24.04.1 /8578418 bytes   | 725a27bbdd5f58d7059ed25d88f14f2d45f6a1ce089585eddc715e04d4a3f79f |

Bun source: [official pinned release](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14), [exact zip](https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-aarch64.zip). Its official release API reports the digest and size above. No install script is used.

Ubuntu sources: [Docker package](https://ports.ubuntu.com/ubuntu-ports/pool/universe/d/docker.io-app/docker.io_29.1.3-0ubuntu3~24.04.2_arm64.deb), [containerd package](https://ports.ubuntu.com/ubuntu-ports/pool/main/c/containerd-app/containerd_2.2.1-0ubuntu1~24.04.4_arm64.deb), [runc package](https://ports.ubuntu.com/ubuntu-ports/pool/main/r/runc-app/runc_1.3.4-0ubuntu1~24.04.1_arm64.deb). Exact versions, lengths and digests came from the guest's existing package metadata. An offline installation simulation selected exactly these three new packages, zero upgrades/removals. All four official artifact URLs returned HEAD200 and matching Content-Length. The cached archive.ubuntu.com ARM64 URLs returned404; use the verified official ports mirror instead. These are pinned candidates, not a claim to the latest release.

## Bounded procedure requested for approval

Download only these four exact artifacts over HTTPS into a fresh private task staging directory on the host. Bound each transfer by its recorded size and deadline; verify every SHA256 before transfer or execution. A mismatch, redirect outside the approved official artifact delivery chain, missing file or extra dependency stops installation. Transfer the verified files through VMPal's file-copy interface; no shared folder and no guest network enablement. Extract only the reviewed Bun executable to `/usr/local/bin/bun`, root-owned0755. Install exactly the three local debs offline with existing package tools; do not refresh repositories, upgrade packages or install recommended extras. No project dependency or lockfile changes.

Package configuration may create local Docker/containerd system services. Inspect their actual versions, sockets, cgroup/security support and state, then keep them stopped until the reviewed runtime-host policy is provisioned. Do not expose a TCP Docker socket or add the guest login to the Docker group. Retain the pinned local installers until post-install readback passes. Guest network and host integration settings stay disabled. Existing util-linux2.39.3 is unchanged; its source/provenance and Bun descriptor behavior need separate proof before journal locking is accepted.

Approval covers these downloads, file transfer and installation in this fresh test VM only. It does not authorize provider accounts, harness installs, model calls, image pulls/builds, project execution, host account access, production changes or deletion of the VM. Installation failure is recorded and stops; no automatic uninstall or scope expansion. Missing runtime-image/runner/mTLS/egress policies remain later explicit gates.

Evidence: currentattempt/runtime-vm/capabilities.json and package-candidates.json under `local evidence`.

## Actual installation receipt

All four downloads matched exact expected lengths and SHA256 values. VMPal's bundled CLI copied only that private staging directory into a root-owned0700 guest staging directory. Its documented copy transport uses a temporary staging share, removed afterward; there is no persistent project/home/profile share. Final VM settings readback confirms sharedFolders/forwardedPorts empty and network/clipboard/dragAndDrop/microphone false with no pending settings.

Guest readback independently verified all four file hashes, the zip's exact two entries, and the three deb package/version/architecture tuples before installation. Offline dpkg installation exited0, installed exactly the approved packages and processed their normal system-service configuration. Docker/containerd services and Docker socket were then stopped and disabled; actual systemd readback reports inactive/dead/disabled for all three. No Docker-group membership was added to the user. Package setup created a down docker0 bridge; the external interface remained DOWN.

Actual nonroot Bun identity is1.3.14, revision0d9b296af33f2b851fcbf4df3e9ec89751734ba4, linux/arm64, uid1000. Installed executable SHA256 is37141662ebed915a2ab89313156e455e2a1374395f5f6760d06407f49406f086,91801560bytes, root0755/nlink1. Existing flock remains the exact previously inventoried binary. Installation and readback job results are retained in runtime-vm/{download-receipt,transferred-installer-verification,installation,bun-identity}.json. This proves installation and isolation settings, not a provisioned supervisor or lock capability.
