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

## Production safety

- Browser login uses an HttpOnly signed session cookie.
- Bridge and callbacks use independent bearer secrets.
- No credentials belong in the repository.
- Production writes remain explicit and approval-gated.
- Web-dispatched Hermes runs use safe mode.
- Newly imported agents remain sandbox/experimental until reviewed.

## Quick start

1. `npm install`
2. Run `./scripts/bootstrap-cloudflare.sh`.
3. Put the returned D1 database ID in `wrangler.toml`.
4. Set Worker secrets: `ADMIN_PASSWORD`, `SESSION_SECRET`, `BRIDGE_URL`, `BRIDGE_TOKEN`, `CALLBACK_TOKEN`.
5. `npm run db:migrate`
6. `npm run deploy`
7. Configure the VPS bridge and Hermes system service.

See `docs/DEPLOYMENT.md`.
