# REA Scout Skill

## Goal
Turn authorized reverse-engineering observations into reusable engineering knowledge without copying protected implementation details.

## Inputs
- Authorized target URL, package, application, or binary
- Scope and purpose
- Runtime/platform information

## Outputs
- `evidence/index.md`
- `architecture.md`
- `feature-map.md`
- `risk-register.md`
- `implementation-plan.md`
- reusable `SKILL.md`

## Workflow
Plan -> Verify authorization -> Isolate -> Observe -> Collect evidence -> Model architecture -> Reimplement cleanly -> Test -> Audit -> Extract skill.

## Acceptance gates
- Evidence supports every major behavior claim.
- No credentials or personal data committed.
- Clean-room implementation is separated from observed proprietary artifacts.
- Security review passes before production use.
- If progress repeats without new evidence, run an OODA loop and change method.
