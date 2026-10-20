# M1 verification record — 2026-10-20

Scope: shared durable Local task core, optional authenticated Remote HTTP adapter, deterministic Fake only. Synthetic fixtures and disposable private directories; no real screenshots, Agent credentials, paid API or VPS.

## Executed locally

Environment: Linux/WSL development checkout; Node v24.19.0, npm 11.17.0, pnpm 10.19.0. Minimum supported runtime additionally tested using Node v22.16.0.

| Command / gate | Result | Observed evidence |
| --- | --- | --- |
| `git fetch origin --prune`, status and divergence inspection | PASS | Clean initial `main`, equal to `origin/main` at `cbb9937`; implementation on `codex/m1-durable-task-core` |
| Initial `npm test` | PASS | Existing 8 contract tests |
| `pnpm install --frozen-lockfile` | PASS | All six workspace projects; committed pnpm lockfile |
| `npm run check` on Node 24.19.0 | PASS, exit 0 | ESLint, strict typecheck, 44/44 tests, JavaScript/declaration build; test phase about 29.5 seconds |
| `npx --yes --package=node@22.16.0 node --experimental-strip-types --test packages/contracts/test/*.test.mjs packages/core/test/*.test.mjs` | PASS, exit 0 | 44/44 tests; about 37.2 seconds; expected experimental SQLite/type stripping warnings |
| Built JavaScript Local CLI (`node dist/apps/cli/src/local.js demo <temporary-root> 5`) | PASS | Five synthetic images, persisted `succeeded` result; temporary directory removed |
| `git diff --check` | PASS | No whitespace errors |

## Automated acceptance mapping

| Requirement | Executed evidence |
| --- | --- |
| Local needs no Relay/server/VPS/credentials | CLI subprocess guard throws on fetch, network connect, HTTP request and server listen; submit/work/get/list succeed independently |
| Durable queue, images and history across process restart | Separate Local CLI processes; both-mode coordinator reopen; abrupt child termination after durable acceptance and verified blob read |
| Identical task/result/state contracts in both modes | Same one/five-image fixtures and Fake Adapter, expected Markdown/artifacts and lifecycle/refusal suite parameterized over Local/Remote |
| Remote complete round trip | Actual ephemeral loopback Fastify socket, authenticated client and Worker; additionally separate capture/Worker CLI subprocesses and server restart |
| Auth and ownership | Missing auth on every route, role denial, other-owner task/file/history denial, rejected forged owner/path/sandbox input, assigned Worker-only input reads |
| Upload reliability/idempotency | Same replay, conflicting content/key/ID, concurrent duplicate uploads, truncated/misordered multipart, corrupted/type-mismatched bytes and rollback/no published files |
| Transactional claims and fencing | Parallel HTTP claims, two SQLite connections, three competing processes, wrong Worker, stale attempt start/heartbeat/complete, heartbeat extension and immutable completion |
| Failure and recovery | Before-start expiry requeues with retained attempt; after-start lease/deadline expiry remains `execution_unknown`; Fake failure/crash/acknowledged timeout/unconfirmed stop; injected input/result storage failure |
| Uncertain execution cannot blindly replay | Agent interruption and lost result transport become unknown; failed completion acknowledgement can replay only the same completion; subsequent Worker run never executes that Agent task again |
| Mode switch preserves original history | Store mode binding refuses cross-mode reopen; separate Remote history remains empty after Local submission |
| Boundary validation | Decoded PNG/JPEG/WEBP, size/hash validation, symlink/corrupt file refusal, bounded result/artifact validation and malformed Relay response rejection before dispatch |

## Limits and unexecuted environments

M1's automated core/Fake gates require no manual action. GitHub CI is configured for Linux and Windows on Node 22/24; its run is separate evidence from this local record. A passing Windows CI job proves only those automated Node/Fake checks, not native desktop behavior.

Not executed in this local record: real Windows tray/clipboard/capture/installer, actual Codex login/image/sandbox/process termination, cross-device TLS routing, push notifications, Windows ACL acceptance or production VPS backup/restore/power-loss acceptance. These are M2–M5 gates with explicit prerequisites/actions/expected results in [Testing](TESTING.md), and are not required to call the Fake M1 implementation complete.

Known M1 limits: experimental built-in SQLite; private crash orphans await later GC; history scans are suitable for a small personal queue; image decode guard is 16 million pixels/single frame; attachments currently plain text and <=1 MiB each; registry/TLS/retention hardening is later scope. See [M1 decisions and usage](M1.md).
