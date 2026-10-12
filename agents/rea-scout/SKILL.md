# REA Scout Skill

## Goal
Turn authorized reverse-engineering observations into reusable engineering knowledge without copying protected implementation details.

## Inputs
- Authorized target URL, package, application, or binary
- Scope and purpose
- Runtime/platform information
- Isolation plan for untrusted artifacts

## Outputs
- `evidence/index.md`
- `architecture.md`
- `feature-map.md`
- `risk-register.md`
- `implementation-plan.md`
- reusable `SKILL.md`

## Workflow
Plan -> Verify authorization -> Create case -> Guard check -> Isolate -> Observe -> Collect evidence -> Model architecture -> Reimplement cleanly -> Test -> Audit -> Extract skill.

## Evidence standard
Each evidence item should capture:
- evidence ID
- observation
- source or reproduction step
- timestamp/hash when relevant
- confidence: Low / Medium / High
- whether the item is fact or hypothesis

Do not elevate a hypothesis to architecture or implementation guidance until it has supporting evidence.

## Acceptance gates
- Evidence supports every major behavior claim.
- No credentials or personal data committed.
- Clean-room implementation is separated from observed proprietary artifacts.
- Security review passes before production use.
- Machine policy passes `npm run rea:guard`.
- If progress repeats without new evidence, run an OODA loop and change method.

## Reuse gate
Promote findings into a reusable skill only when the pattern is reproduced, tested, and independent of protected source/assets. Record prerequisites, procedure, failure modes, and validation tests.
