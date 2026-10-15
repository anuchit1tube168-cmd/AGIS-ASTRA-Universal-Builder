# ASTRA Skill Extractor

Status: DRAFT
Version: 0.1.0
Owner: ASTRA Skill Factory

## Capability

Extract a reusable Skill Candidate from a completed AGIS × ASTRA task, then route it through review before Git registration and Skills Hub distribution.

## Preconditions

- Source task status is `completed`.
- Source task is not REA raw analysis and is not another extractor task.
- Source result contains enough evidence to identify a reusable procedure.
- Skill Extractor runtime is enabled only in staging.

## Procedure

1. Create a candidate record linked to the completed source task.
2. Queue a `skill-extractor` task with a strict extraction envelope.
3. Execute Hermes in a dedicated HOME/workspace with an allowlisted environment.
4. Parse the returned JSON and reject malformed or oversized fields.
5. Sanitize identifier, version, arrays, targets, and free-text fields.
6. Store the candidate as `PENDING_REVIEW` in D1.
7. Human reviewer confirms tests and security before `APPROVED_FOR_GIT`.
8. Export candidate material for a Git-reviewed `SKILL.md` + registry change.
9. After canonical registration, create a Skills Hub dry-run sync plan.
10. Only a separate reviewed distribution action may later write staging copies.

## Output schema

- id
- name
- version
- owner
- capability
- procedure[]
- acceptance_tests[]
- failure_modes[]
- distribution_targets[]

## Safety rules

- Never auto-write `skills/registry.json` from model output.
- Never auto-sync to Codex, Hermes, OpenCode, Antigravity, or production directories.
- Never inherit Control Plane credentials into the extractor child process.
- Never accept REA raw artifacts, credentials, personal data, private keys, cookies, or proprietary source as reusable skill content.
- Every extraction, review, rejection, and sync plan is audit logged.

## Distribution planning

Use the pinned Skills Hub adapter conventions for supported targets:

- Codex: `.codex/skills`
- OpenCode: `.config/opencode/skills`
- Antigravity global skills: `.gemini/antigravity/global_skills`
- Hermes: configured as a reviewed custom directory

The planner is dry-run only and must return `executed=false`.

## Acceptance tests

- Worker TypeScript check passes.
- Bridge syntax check passes.
- Extractor cannot run unless both Worker and Bridge staging gates are enabled.
- Extractor rejects REA and extractor source tasks.
- Invalid JSON output fails closed.
- Candidate approval does not mutate canonical Git files.
- Sync plan never writes files and records `executed=0`.
