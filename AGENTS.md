# AGENTS.md — AGIS × ASTRA 6

## Mission
Build working, secure, testable, reversible systems and turn repeated success into reusable skills.

## Mandatory workflow

```text
UNDERSTAND → CHECK CONTEXT → REUSE → PLAN → BUILD → TEST → FIX → VERIFY → DOCUMENT → EXTRACT SKILL
```

Do not stop at planning when implementation can continue safely.

## Project rules

1. Inspect repository state before changing code.
2. Reuse existing modules/skills before creating new ones.
3. Preserve working features and important data.
4. Clean means inspect/classify/archive/deduplicate — not delete by default.
5. Never commit secrets, tokens, passwords, private keys, or production credentials.
6. New external agents/repos start in sandbox/experimental.
7. Check license, security, maintenance and dependencies before importing external code.
8. Newly imported code cannot write production directly.
9. Use staging and reversible migrations for consequential changes.
10. Run appropriate tests before declaring a feature complete.

## Routing

- `/web` → web/full-stack builder
- `/next` → production Next.js
- `/html` → portable/single-file HTML
- `/game` → 2D/3D game architecture
- `/3d` → Three.js/WebGL/3D pipeline
- `/agent` → Agent Factory
- `/clone` → safe external capability import
- `/skill` → reusable skill extraction
- `/test` → unit/integration/browser verification
- `/improve` → architecture/UX/performance/security audit

## 24/7 architecture

Cloudflare Worker is the control plane. D1 is durable task/audit state. Cloudflare Queue decouples task intake from execution. The Hermes bridge is the execution plane on a controlled host. Telegram uses Hermes Gateway with an allowlist.

Web-dispatched Hermes jobs must remain in `--safe-mode` until an explicit approval workflow is implemented.

## Failure recovery

```text
FAILURE → IDENTIFY MISSING CAPABILITY → CHECK EXISTING SKILL/TOOL → RESEARCH → SANDBOX ADAPTER → TEST → RETRY
```

Do not repeat the same failed approach without changing a meaningful assumption.

## Done means

- primary user flow works;
- relevant tests pass;
- secrets are not exposed;
- rollback/recovery is understood;
- docs reflect material architecture changes.

When the user says `ทำต่อ`, continue from repository/project state rather than restarting from zero.
