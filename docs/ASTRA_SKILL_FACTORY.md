# ASTRA Skill Factory Dashboard

ASTRA Skill Factory turns proven work into governed reusable skills without allowing Skills Hub to auto-sync or write to production by itself.

## Architecture

```text
Scout / Build Agent
      ↓
reusable pattern
      ↓
SKILL.md
      ↓
Git canonical registry: skills/registry.json
      ↓
D1 operational projection: skill_catalog + skill_events
      ↓
Mission Control Skills Dashboard
      ↓
reviewed one-step promotion
      ↓
Skills Hub staging distribution (separate action; not implemented by promotion API)
```

## Lifecycle

```text
DRAFT
  ↓
VALIDATED
  ↓
SECURITY_REVIEWED
  ↓
REGISTRY_APPROVED
  ↓
STAGING_SYNC
  ↓
VERIFIED
  ↓
PRODUCTION_APPROVED
```

The API calculates the next state. Clients cannot submit an arbitrary destination state and therefore cannot skip a lifecycle gate.

## Promotion gates

- `VALIDATED` requires `test_status=PASS`.
- `SECURITY_REVIEWED` requires explicit security review confirmation and records `security_status=PASS`.
- `REGISTRY_APPROVED` requires tests and security review to pass.
- `STAGING_SYNC` records lifecycle approval only. It does **not** execute Skills Hub sync.
- `VERIFIED` requires explicit confirmation that the distributed staging copies were tested in their target tools.
- `PRODUCTION_APPROVED` requires explicit operator confirmation. It records approval metadata only and does **not** enable production writes, remote publishing, or auto-sync.

## Canonical vs operational data

`skills/registry.json` remains the canonical Git-reviewed manifest. D1 is the operational projection used for Mission Control state and event history. A future reconciliation job may compare Git and D1, but it must never silently overwrite the canonical manifest.

## Audit

Every lifecycle promotion writes both:

- `skill_events` — per-skill state transition history.
- `audit_log` — Control Plane audit trail.

The dashboard exposes skill event history in the Inspector panel.

## Current registered skills

1. `rea-evidence-scout` — security reviewed, tests pass.
2. `astra-skill-registry-management` — validated, tests pass, security review pending.

## Safety defaults

- Skills Hub auto-sync: OFF
- Production write: OFF
- Remote publish: OFF
- Credential access: OFF
- Canonical registry modifications: Git review only

## Deployment order

After merge, apply the D1 schema before deploying the Worker that queries the new tables:

```bash
npm run skills:guard
npm run db:migrate
npm run check
npm run deploy
```

The merge itself does not run Skills Hub, distribute skills, or enable production writes.
