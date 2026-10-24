# M12-V — bounded Linux VPS Agent Worker plan (not implemented)

Topology: Windows capture client → HTTPS Relay → separate Linux Worker → approved Codex/Claude CLI → Relay → original Windows receiver. Windows Workers remain supported. Relay continues to store, lease and transport tasks; it never launches an Agent. Local remains usable with no Relay configuration or requests.

## Implementation slice

Reuse `services/relay/src/client.ts`, existing WorkerPort, execution registry and `packages/worker` task loop. Introduce a platform process/approval adapter at CLI discovery, exact executable identity, child environment, sandbox capability checks, credential access and process-tree termination. Keep core states, image/result limits, profile hashes, durable outbox and receiving Windows delivery unchanged. Do not duplicate the Worker/task core for Linux.

Start one dedicated non-root Worker process/container on the same personal VPS. Give it its own device Token, durable private state volume, bounded scratch volume and one explicitly approved workspace mount. No Docker socket, host root mount, inbound published port or Relay credential sharing. An explicit mounted secret file is the headless Linux credential adapter; it is not included in images, task metadata or logs. Windows continues to use Credential Manager. Linux profile discovery and approval initially belong to the deployment operator; ordinary Windows users discover the published Worker through the existing computer/Agent selector.

For same-host deployment, use the internal Compose network and explicit trusted Relay service address. The present client requires HTTPS except loopback: add a narrowly configured server-owned internal-network transport option for this Worker, rather than broadly weakening Windows URL validation. Public origin clients retain HTTPS. Document device registration and independent Token rotation after the Worker is idle.

Linux launch must attest CLI version/capabilities with synthetic mock first. Pin absolute executable + version/fingerprint, use argument arrays without shell, minimal environment and approved read-only workspace. Provider image support, exact Linux sandbox facilities and login portability must be qualified per CLI; fail visibly when unavailable. Do not assume Windows approval carries across OS/paths. No paid request is part of unattended acceptance.

Use a process group/session plus bounded graceful-stop/kill and confirmed descendant exit; container memory/CPU/PID limits and scratch quota. One execution slot per Worker, covering claim through settlement. Persist accepted start identity and fencing before invoking CLI. Never re-execute a possibly started attempt after crash. Expired unstarted claims may recover; started/unknown attempts settle as `execution_unknown`. Restart reconciliation must prove there are no surviving old descendants before accepting work. Duplicate result settlement/download must remain idempotent.

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
