# REA Scout Pipeline

This integration turns REA into a controlled evidence-gathering capability for AGIS × ASTRA. It is intentionally staging-only.

## Safety model

- REA upstream is pinned to a reviewed commit through a git submodule.
- `agents/rea-scout/policy.json` is the machine-readable policy source.
- `scripts/rea-guard.mjs` verifies the upstream URL, locked SHA, gitlink, critical policy flags, runtime isolation markers, and default-off production posture.
- GitHub Actions runs the guard without initializing the REA submodule, installing REA dependencies, or executing target binaries.
- Production writes, credential access, access-control bypass, DRM bypass, anti-cheat bypass, and personal-data collection remain disabled.
- Unknown binaries require an isolated VM/container before analysis.
- REA child processes use a dedicated Hermes home and workspace, not the normal Bridge process environment.

## Safe bootstrap

```bash
git checkout integration/rea-scout-20261012
npm run rea:guard
npm run rea:init
```

`rea:init` only initializes the pinned source and verifies its origin and SHA. It does not install REA dependencies and does not run REA setup.

## Create a local case scaffold

Every case must start with explicit authorization:

```bash
npm run rea:new-case -- advisor-booking-reference --authorized --type=web --target=https://example.invalid
```

This creates:

```text
rea-cases/<case-id>/
├── case.json
├── evidence/index.md
├── architecture.md
├── feature-map.md
├── risk-register.md
├── implementation-plan.md
└── SKILL.md
```

Creating a local case does not execute REA.

## Mission Control runtime

Phase 2 adds first-class REA case management to the existing control plane:

```text
Mission Control UI / API
  -> D1 rea_cases + rea_events
  -> TASK_QUEUE kind=rea-scout
  -> AGIS Bridge
  -> isolated REA Hermes HOME/workspace
  -> callback
  -> case result + audit trail
```

A case created while runtime execution is off is stored as `awaiting_runtime`. It is not dispatched.

Execution requires two independent gates:

- Worker: `APP_ENV=staging` and `REA_RUNTIME_ENABLED=true`.
- Bridge: `REA_EXECUTION_ENABLED=true`, a dedicated `REA_HERMES_HOME`, and an isolated `REA_WORKSPACE_ROOT` that is not the AGIS repository.

Committed configuration keeps both execution gates disabled. See `docs/REA_RUNTIME_PHASE2.md` for setup and isolation details.

## Operating flow

```text
INTAKE
  ↓
AUTHORIZATION GATE
  ↓
ISOLATION PLAN
  ↓
QUEUE / RUNTIME GATE
  ↓
OBSERVE / COLLECT EVIDENCE
  ↓
ARCHITECTURE + FEATURE MAP
  ↓
CLEAN-ROOM IMPLEMENTATION PLAN
  ↓
BUILD AGENT
  ↓
TEST
  ↓
SECURITY AUDITOR
  ↓
SKILL EXTRACTION
```

If an investigation repeats without producing new evidence, run an OODA loop and change the observation method rather than repeating the same action.

## Promotion gates

A case cannot be promoted toward production until all of the following are true:

1. Authorization scope is documented.
2. Major behavior claims cite evidence.
3. No credentials, personal data, proprietary source, or private assets are committed.
4. The implementation is clean-room and separated from observed protected artifacts.
5. Security review passes.
6. Production access is approved separately from the REA environment.

REA itself remains staging-only; a clean-room implementation may be promoted only through the normal Build/Test/Audit pipeline.

## Upstream upgrades

Do not move `vendor/rea` directly to upstream `main`. Review the candidate upstream commit, update `REA_UPSTREAM.lock.json`, update the submodule gitlink, run `npm run rea:guard`, and review the resulting diff before merge.
