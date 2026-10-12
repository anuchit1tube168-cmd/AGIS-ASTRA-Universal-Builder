# AGIS × ASTRA 6 — 24/7 Production Control Plane

Production-oriented starter for a persistent AGIS control system.

## Architecture

```text
Web Mission Control ─┐
                     ├─> Cloudflare Worker/API
GitHub / automations ┘          │
                               ├─ D1: tasks, audit, agent registry
                               ├─ D1: REA Scout cases/events
                               ├─ Queue: durable async dispatch
                               └─ callback / heartbeat
                                      │
                                      ▼
                              AGIS Agent Bridge (VPS)
                                ├─ Hermes generic runtime
                                └─ REA Scout isolated runtime
                                      │
                              Codex / skills / tools

Telegram ───────────────> Hermes Gateway (24/7 systemd)
```

## REA Scout Agent

Reverse Engineer Anything (REA) is integrated as a **pinned, staging-only Scout capability** under `vendor/rea`.

```text
Authorized target
      ↓
Mission Control REA Case
      ↓
Authorization + runtime gates
      ↓
REA Scout / evidence collection
      ↓
evidence → architecture → feature map → risk register
      ↓
clean-room implementation plan
      ↓
Build Agent → Test → Security Auditor → SKILL.md
```

Safe source/case commands:

```bash
npm run rea:guard
npm run rea:init
npm run rea:new-case -- <case-name> --authorized --type=web --target=<reference>
```

`rea:init` only initializes the locked source commit. It does not install REA dependencies or run REA setup.

Phase 2 also exposes REA cases in Mission Control. When runtime execution is off, authorized cases are stored as `awaiting_runtime` and are not dispatched. Execution requires both `APP_ENV=staging` + `REA_RUNTIME_ENABLED=true` on the Worker and `REA_EXECUTION_ENABLED=true` on a Bridge configured with a dedicated REA Hermes home/workspace.

See `docs/REA_SCOUT_PIPELINE.md` and `docs/REA_RUNTIME_PHASE2.md`.

## Production safety

- Browser login uses an HttpOnly signed session cookie.
- Bridge and callbacks use independent bearer secrets.
- No credentials belong in the repository.
- Production writes remain explicit and approval-gated.
- Web-dispatched Hermes runs use safe mode.
- Newly imported agents remain sandbox/experimental until reviewed.
- REA Scout is staging-only and cannot be promoted without evidence and security review.
- REA child processes receive a dedicated HOME/workspace and an allowlisted environment instead of the Bridge environment.
- Committed Worker and Bridge configuration keeps REA execution disabled.

## Quick start

1. `npm install`
2. Run `./scripts/bootstrap-cloudflare.sh`.
3. Put the returned D1 database ID in `wrangler.toml`.
4. Set Worker secrets: `ADMIN_PASSWORD`, `SESSION_SECRET`, `BRIDGE_URL`, `BRIDGE_TOKEN`, `CALLBACK_TOKEN`.
5. `npm run db:migrate`
6. `npm run deploy`
7. Configure the VPS bridge and Hermes system service.

For REA, run `npm run rea:guard` before any source initialization or staging configuration. Do not enable REA execution in production.

See `docs/DEPLOYMENT.md`, `docs/REA_SCOUT_PIPELINE.md`, and `docs/REA_RUNTIME_PHASE2.md`.
