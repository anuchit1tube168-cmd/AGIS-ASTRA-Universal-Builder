# REA Scout Pipeline

This integration turns REA into a controlled evidence-gathering capability for AGIS × ASTRA. It is intentionally staging-only.

## Safety model

- REA upstream is pinned to a reviewed commit through a git submodule.
- `agents/rea-scout/policy.json` is the machine-readable policy source.
- `scripts/rea-guard.mjs` verifies the upstream URL, locked SHA, gitlink, and critical policy flags.
- GitHub Actions runs the guard without initializing the REA submodule, installing REA dependencies, or executing target binaries.
- Production writes, credential access, access-control bypass, DRM bypass, anti-cheat bypass, and personal-data collection remain disabled.
- Unknown binaries require an isolated VM/container before analysis.

## Safe bootstrap

```bash
git checkout integration/rea-scout-20261012
npm run rea:guard
npm run rea:init
```

`rea:init` only initializes the pinned source and verifies the SHA. It does not install REA dependencies and does not run REA setup.

## Create a case

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

Creating a case does not execute REA.

## Operating flow

```text
INTAKE
  ↓
AUTHORIZATION GATE
  ↓
ISOLATION PLAN
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

## Upstream upgrades

Do not move `vendor/rea` directly to upstream `main`. Review the candidate upstream commit, update `REA_UPSTREAM.lock.json`, update the submodule gitlink, run `npm run rea:guard`, and review the resulting diff before merge.
