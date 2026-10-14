# ASTRA Skill Registry Management

Status: VALIDATED
Version: 1.0.0
Owner: ASTRA Skill Factory

## Capability

Manage the lifecycle of reusable AGIS × ASTRA skills from extraction through review, staging distribution, verification, and explicit production approval.

## Canonical sources

- `skills/registry.json` is the Git-tracked canonical registry manifest.
- D1 `skill_catalog` and `skill_events` are operational runtime projections for Mission Control.
- Distributed copies in Codex, Hermes, OpenCode, or other tools are outputs and are never canonical.

## Lifecycle

`DRAFT -> VALIDATED -> SECURITY_REVIEWED -> REGISTRY_APPROVED -> STAGING_SYNC -> VERIFIED -> PRODUCTION_APPROVED`

Promotion must move one state at a time. A later state must never be written directly.

## Gates

1. `VALIDATED`: reusable procedure and tests are documented.
2. `SECURITY_REVIEWED`: security status is PASS.
3. `REGISTRY_APPROVED`: canonical registry entry is present and reviewed.
4. `STAGING_SYNC`: distribution is limited to staging/test targets.
5. `VERIFIED`: distributed copies were tested in their target tools.
6. `PRODUCTION_APPROVED`: requires explicit human confirmation; this records approval metadata only and does not itself enable production writes or auto-sync.

## Safety rules

- Auto-sync remains disabled by default.
- Production writes remain disabled by policy.
- No credentials, private keys, personal data, raw REA artifacts, or unreviewed proprietary source may enter a skill package.
- Every promotion creates an audit event with actor, previous state, next state, and timestamp.
- Rollback/distribution actions are separate from lifecycle promotion and require their own reviewed implementation.

## Acceptance tests

- Registry guard passes.
- Worker TypeScript check passes.
- Skill cannot skip lifecycle states.
- Skill cannot enter `SECURITY_REVIEWED` unless security status is PASS.
- `PRODUCTION_APPROVED` requires explicit confirmation.
- No promotion endpoint triggers Skills Hub sync, remote publish, or production writes.
