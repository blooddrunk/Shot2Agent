# M12-V — bounded Linux VPS Agent Worker implementation

Implemented from baseline `2c7f5ce6a15ad23f909e1f08ebf4a18c694c9567` as development candidate `1.1.0-dev.6`. [Deployment](../deploy/relay/WORKER.md) and [executed validation / genuine environment limits](M12_V_VALIDATION.md) are the operational handoff. No Local tag/Release is modified; no formal Remote release.

Topology: Windows capture client → HTTPS Relay → separate Linux Worker → approved Codex/Claude CLI → Relay → original Windows receiver. Windows Workers remain supported. Relay continues to store, lease and transport tasks; it never launches an Agent. Local remains usable with no Relay configuration or requests.

## Implementation slice

`apps/cli/src/linux-worker.ts` uses the existing RemoteClient, WorkerPort, execution registry and `runOnce`. `linux-worker.ts` holds a bounded single in-flight start/result journal through the existing SQLite store; it does not create tasks or another task core. `linux-platform.ts` binds Linux uid/secret/workspace/program approval, private child homes and durable process-group identity. Shared CLI adapters and Linux discovery/process extensions preserve Windows behavior. Core task states, image/result limits, outbox and Windows delivery are unchanged.

The separate Compose overlay starts one non-root outbound Worker, with independent device Token, durable private volume, 256 MiB scratch tmpfs and one read-only workspace. No Docker socket, host root mount, inbound published port or Relay registry mount. Explicit 0600/uid-owned secret files support Linux Codex auth.json, Claude personal credentials, or Claude + GLM Token; Windows continues to use Credential Manager. Linux discovery/approval belongs to the deployment operator; Windows users use the unchanged computer/Agent selector. CLI images pin versions, approvals hash the actual executable and immutable config. Per-id current capabilities are visible; historical versions remain bound for queued work.

Same-host deployment explicitly trusts only the exact configured `http://relay:3100/` (or a validated private IPv4 origin); URL userinfo/query/path/public host/redirects refuse. The desktop validator does not consume this option and retains HTTPS. `add-worker` provisions role=worker; rotation preserves the role. Startup validates expected owner/device/role and binds durable state to that identity. [Guide](../deploy/relay/WORKER.md) covers registration and idle rotation.

Version/help and capability checks run without a model request. Codex additionally proves local sandbox startup with `/usr/bin/true`, refusing unavailable kernel/container isolation. Claude retains restricted/safe-mode, no tools, strict empty MCP and isolated settings; managed policies and unsupported versions refuse. GLM uses the existing endpoint/model allowlists and explicit Linux secret-file adapter, independently of personal Claude login. No paid request is part of unattended CI. The user separately authorized limited VPS GLM-5.3-Flash synthetic testing; its actual result is recorded separately, never inferred from mocks.

Use a detached process group/session, bounded TERM/KILL and `/proc` live-descendant confirmation on timeout/cancel **and successful parent exit**. Persist boot/PID/starttime before writing stdin. Restart takes the shared SQLite process lock, confirms old groups are dead, then removes only owned scratch. Start/fencing is journaled before the request; a crash without a known result settles unknown and never re-executes. Known completed results survive transport loss and are resubmitted idempotently. Relay still owns lease expiration/fencing. One execution slot covers claim through process settlement. Resource/config/credential/corrupt-state failures refuse.

## Acceptance matrix

| Area | Automated gate | Small genuine deployment observation |
| --- | --- | --- |
| Platform adapters | Same Windows/Linux Fake/mock fixtures; CLI discovery/version/policy refusal, Unicode paths, large ordered images, cancellation/descendants | Selected approved Linux CLI can start in configured workspace; paid synthetic vision only with separate authorization |
| Binding and discovery | GUI lists Linux device/current Agent; old queued versions remain immutable; missing binding refuses, Windows Worker stays selectable | Windows selects VPS by ordinary computer label without CLI configuration |
| Queue and recovery | Offline Worker, lease/fencing loss before/after start, duplicate upload/result, DB/volume restart, full disk/corruption, one slot | Stop/restart the isolated VPS Worker during one Fake task; one result or explicit unknown, no replay |
| Credential/network | Dedicated temporary Tokens, owner isolation, redacted logs, secret absent from image; internal address allowlist and no published Worker port | Real HTTPS Windows↔Relay; internal Worker↔Relay route |
| Resources | Docker CPU/memory/PID limits, process timeout, scratch exhaustion and bounded cleanup; no leaked CLI descendants | Confirm limits on same personal VPS |
| Local/Windows regression | Existing no-Relay Local conformance, Windows Remote Worker, Smart/manual/file delivery and outbox restart suites | Repeat only changed or previously unverified physical paths |

Deliver one focused M12-V PR after M11-X stabilizes. No web history, push, failover, multi-tenant service, autoscaling or full infrastructure rewrite. Shipping readiness requires exact-SHA Linux image and Windows candidate evidence plus the small deployment observation above; Fake/green compilation alone never qualifies real provider behavior.
