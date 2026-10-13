# Skills Hub Integration — Skill Registry Layer

Skills Hub is integrated as a pinned, review-gated registry/distribution layer for validated Agent Skills.

## Role in AGIS × ASTRA

```text
REA Scout
  -> evidence
  -> clean-room implementation
  -> tests
  -> security audit
  -> validated SKILL.md
  -> Skill Registry (Skills Hub)
  -> staging sync to selected agents/tools
  -> verification
  -> explicit production approval
```

Skills Hub does not replace REA, Hermes, Codex, or the Build Agent. Its role is to maintain one canonical skill library and distribute approved skills to supported tool directories.

## Upstream

- Project: `qufei1993/skills-hub`
- Integration: git submodule at `vendor/skills-hub`
- Locked commit: see `agents/skill-registry/SKILLS_HUB_UPSTREAM.lock.json`
- License: MIT
- Auto-sync: disabled
- Production writes: disabled

## Safe bootstrap

```bash
npm run skills:guard
npm run skills:init
```

`skills:init` only initializes the pinned source and verifies origin/SHA. It does not run npm install, Cargo, Tauri, the desktop application, or any skill sync.

## Promotion contract

A skill may enter the registry only after:

1. source/provenance is recorded;
2. behavior is validated by tests or reproducible evidence;
3. security review passes;
4. no credentials, personal data, raw REA artifacts, or proprietary source are present;
5. supported targets are declared;
6. rollback reference is available.

Promotion states:

`DRAFT -> VALIDATED -> SECURITY_REVIEWED -> REGISTRY_APPROVED -> STAGING_SYNC -> VERIFIED -> PRODUCTION_APPROVED`

## Canonical-source rule

The registry copy is canonical. Agent-specific copies are generated/synced outputs. Do not hand-edit distributed copies because that creates skill drift.

## Rollout plan

Phase A (current): source pinned, policy/guard only, no runtime sync.

Phase B: create AGIS skill catalog manifest and import only validated local skills.

Phase C: staging sync to a small target set (Codex + isolated Hermes profile), verify hashes and behavior.

Phase D: optional broader tool distribution after explicit approval.
