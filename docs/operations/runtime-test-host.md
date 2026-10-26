# Dedicated runtime test host proposal

Status: user-approved dedicated VM installed, isolated, and inventoried. Separately approved pinned runtime tools are installed; see [installation receipt](runtime-test-host-install.md). The accepted linux-systemd-v1 design requires a Linux control plane on the Docker host; current macOS Docker access alone does not prove it. This is a local test host, not a production deployment.

Before creation, read-only VMPal inventory on2026-10-22 found a cached Pop!_OS24.04 LTS base, build24.04-3,2.9GB, with no download/transfer running and no task-owned VM. Cached OS availability did not establish its runtime capabilities; the later actual guest inventory and installation receipt do.

Proposed fresh VM: name `zetta-v1-runtime`, system `baseOS:Pop!_OS 24.04 LTS`, user `zetta`,2CPU,6GiB RAM,64GB disk limit, GPU acceleration off, installUpdates false. Enable agent control for the new task VM. Set sharedFolders empty, clipboard/dragAndDrop/microphone off and forwardedPorts empty; confirm those settings before transferring or running project files. Keep guest network disabled for the initial capability inventory where supported. No host home/profile/credential mount or existing account is an execution input.

Creation approval covers only this fresh local VM from the cached base and its isolation settings. No package installation, provider login, paid call, external service modification or production deployment follows from it. First read-only guest inventory must establish OS/kernel, systemd availability, Docker availability/architecture, cgroup/resource controls, clock, free resources and guest agent access without reading account/profile contents. Missing capabilities fail closed.

Before any software installation, prepare a separate exact source/version/install manifest and approved network policy. Before executing attempts, build/pin the reviewed fixture image, provision mTLS/runner/cleanup/journal policy, then prove actual A/B containment, independent deadlines, owner-crash cleanup and uncertainty. GUI/native/provider tests retain their own accepted boundaries. Task completion does not require deleting the VM without explicit user request; retain its exact identity for review and later cleanup.

Approval source: tasks/README.md requires authorization for genuinely new infrastructure/environment changes. Creation/isolation and the separate exact tool installation were explicitly approved; unrelated code/schema/disposable PostgreSQL work continues independently.

## Approved creation receipt

The user explicitly answered “Approve the dedicated test VM” on2026-10-22. VMPal created only `zetta-v1-runtime`, ID `1FB29298-C5D4-4056-AC29-A174E1A43F50`, at its managed location. The existing `niri` VM was not changed. The new VM uses the cached Pop!_OS base with2CPU/6GiB/64GB, user `zetta`, GPU off and installUpdates false. Readback during OS installation confirmed agentControl true, sharedFolders/forwardedPorts empty, network/clipboard/dragAndDrop/microphone/speakers false, and no pending settings. Account credentials returned by VMPal are not copied into project evidence.

This creation receipt alone does not prove runtime capability or authorize software installation/provider access. The later read-only guest inventory and separately approved tool installation are recorded in the linked installation receipt. Journal locking, file durability and operational supervisor remain distinct proof gates.
