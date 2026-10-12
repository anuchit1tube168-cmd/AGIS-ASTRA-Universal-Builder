# AGIS × ASTRA 6 — 24/7 Production Control Plane

Production-oriented starter for a persistent AGIS control system.

## Architecture

```text
Web Mission Control ─┐
                     ├─> Cloudflare Worker/API
GitHub / automations ┘          │
                               ├─ D1: tasks, audit, agent registry
                               ├─ Queue: durable async dispatch
                               └─ callback / heartbeat
                                      │
                                      ▼
                              AGIS Agent Bridge (VPS)
                                      │
                              Hermes one-shot runner
                                      │
                              Codex / skills / tools

Telegram ───────────────> Hermes Gateway (24/7 systemd)
```

## REA Scout Agent

Reverse Engineer Anything (REA) is integrated as a **pinned, staging-only Scout capability** under `vendor/rea`.

```text
Authorized target
      ↓
REA Scout / evidence collection
      ↓
evidence → architecture → feature map → risk register
      ↓
clean-room implementation plan
      ↓
Build Agent → Test → Security Auditor → SKILL.md
```

Safe commands:

```bash
npm run rea:guard
npm run rea:init
npm run rea:new-case -- <case-name> --authorized --type=web --target=<reference>
```

`rea:init` only initializes the locked source commit. It does not install REA dependencies or run REA setup. Production writes and credential access remain disabled by policy. See `docs/REA_SCOUT_PIPELINE.md`.

## Production safety

- Browser login uses an HttpOnly signed session cookie.
- Bridge and callbacks use independent bearer secrets.
- No credentials belong in the repository.
- Production writes remain explicit and approval-gated.
- Web-dispatched Hermes runs use safe mode.
- Newly imported agents remain sandbox/experimental until reviewed.
- REA Scout is staging-only and cannot be promoted without evidence and security review.

## Quick start

1. `npm install`
2. Run `./scripts/bootstrap-cloudflare.sh`.
3. Put the returned D1 database ID in `wrangler.toml`.
4. Set Worker secrets: `ADMIN_PASSWORD`, `SESSION_SECRET`, `BRIDGE_URL`, `BRIDGE_TOKEN`, `CALLBACK_TOKEN`.
5. `npm run db:migrate`
6. `npm run deploy`
7. Configure the VPS bridge and Hermes system service.

See `docs/DEPLOYMENT.md` and `docs/REA_SCOUT_PIPELINE.md`.
