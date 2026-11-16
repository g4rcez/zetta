# Playground: container runners with their real images

Run: 2026-11-15 22:23 UTC. Result: **GREEN** (7 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/playground-containers.ts`. Needs: a container engine and a network for the first image pull.

| Check                                           | Result | Detail                                   |
| ----------------------------------------------- | ------ | ---------------------------------------- |
| typescript: runs in bun:1.3.14                  | pass   | 1.3.14                                   |
| javascript: runs in bun:1.3.14                  | pass   | 1.3.14                                   |
| python: runs in python:3.13-slim                | pass   | Python 3.13.18                           |
| bash: runs in debian:trixie-slim                | pass   | GNU bash, version 5.2.37(1)-release (aar |
| a failing script reports its exit code (python) | pass   |                                          |
| the root file system is read-only (bash)        | pass   |                                          |
| a script over its time limit is stopped (bun)   | pass   |                                          |

## Notes

- Engine: podman. Images: docker.io/oven/bun:1.3.14, docker.io/oven/bun:1.3.14, docker.io/library/python:3.13-slim, docker.io/library/debian:trixie-slim.
- Not covered: the network setting (`ZETTA_PLAYGROUND_NETWORK`), memory and process limits under load, and gVisor.
