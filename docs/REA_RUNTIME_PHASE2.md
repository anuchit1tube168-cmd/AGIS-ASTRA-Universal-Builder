# REA Scout Runtime — Phase 2

Phase 2 connects the policy-gated REA Scout capability to the existing AGIS × ASTRA Control Plane without enabling REA in production.

## Runtime flow

```text
Mission Control
  -> POST /api/rea/cases
  -> D1 rea_cases + rea_events
  -> TASK_QUEUE (kind=rea-scout)
  -> AGIS Bridge /dispatch
  -> dedicated REA Hermes HOME + workspace
  -> Hermes safe mode with REA skill/MCP
  -> /internal/task-result
  -> D1 case status/result/audit
```

## Deployment order

For an existing control-plane installation, apply the idempotent D1 schema before deploying the Worker that queries the new REA tables:

```bash
npm run rea:guard
npm run db:migrate
npm run check
npm run deploy
```

The schema uses `CREATE TABLE IF NOT EXISTS`, so existing tasks/audit/agents tables are preserved while `rea_cases` and `rea_events` are added.

## Two independent execution gates

REA execution requires both gates to be enabled:

1. Cloudflare Worker: `APP_ENV=staging` and `REA_RUNTIME_ENABLED=true`.
2. Bridge: `REA_EXECUTION_ENABLED=true` with dedicated `REA_HERMES_HOME` and `REA_WORKSPACE_ROOT`.

The committed defaults keep both execution gates off. Creating a case while the Worker gate is off records the authorized case as `awaiting_runtime` without dispatching it.

## Isolation requirements

- `REA_HERMES_HOME` must be a dedicated staging-only Hermes home. Do not reuse the normal operator or production Hermes home.
- `REA_WORKSPACE_ROOT` must be an isolated workspace and must not be the AGIS repository root.
- REA child processes receive an allowlisted environment rather than the Bridge process environment.
- Control Plane bearer tokens, callback tokens and unrelated production credentials are not forwarded to REA child processes.
- The systemd template grants write access only to the repo, REA Hermes home and REA workspace, with `UMask=0077`.
- Unknown binaries still require OS/container/VM isolation; this application-level separation is not a malware sandbox.

## Hermes + REA registration

REA supports Hermes as client id `hermes`. Plan the exact setup transaction before applying it:

```bash
export HOME=/opt/agis/rea-hermes-home
node vendor/rea/scripts/rea.mjs setup --client hermes --dry-run --json
```

Only after reviewing the plan, intentionally apply the scoped Hermes configuration:

```bash
export HOME=/opt/agis/rea-hermes-home
node vendor/rea/scripts/rea.mjs setup --client hermes --yes --json
node vendor/rea/scripts/rea.mjs doctor --client hermes --json
```

This assumes the pinned source checkout has its reviewed runtime dependencies available. Do not replace the pinned source with `@latest` in unattended production automation.

## Case lifecycle

`intake -> awaiting_runtime | queued -> dispatching -> running -> completed | failed`

Every case stores a sanitized target reference, an explicit scope, authorization confirmation, staging-only environment and `production_write=false`.

## Production rule

Merging Phase 2 is allowed with runtime execution disabled. Enabling the runtime is a separate staging configuration action. Production execution remains prohibited by the REA Scout policy.
