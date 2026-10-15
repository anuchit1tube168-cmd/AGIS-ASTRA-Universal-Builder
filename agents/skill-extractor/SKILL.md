# ASTRA Skill Extractor

Status: DRAFT
Version: 0.1.0
Owner: ASTRA Skill Factory

## Capability

Extract a reusable Skill Candidate from a completed AGIS × ASTRA task, then route it through human review before Git registration and Skills Hub distribution.

## Preconditions

- Source task status is `completed` and contains a non-trivial result.
- Source task is not REA analysis and is not another extractor task.
- Source task passes the credential-material pre-scan.
- Worker is staging and `SKILL_EXTRACTOR_ENABLED=true`.
- Bridge independently has `SKILL_EXTRACTOR_EXECUTION_ENABLED=true`.
- Bridge uses a dedicated Skill Extractor Hermes HOME and workspace.

## Procedure

1. Operator selects an eligible completed task in `/skills.html`.
2. Control Plane scans source command/result for known credential patterns.
3. Control Plane creates a linked `skill_candidates` record with `EXTRACTING` status.
4. Control Plane queues an extractor task with a strict `SKILL_EXTRACTOR_SOURCE` envelope.
5. Existing queue dispatches the task to the Bridge; the Bridge recognizes `skill-extractor:<sourceTaskId>` and forces isolated execution.
6. Hermes runs `--safe-mode` with a sanitized environment, dedicated HOME, and dedicated workspace.
7. Extractor returns one strict JSON object only.
8. Control Plane validates id, semver, arrays, target allowlist, size limits, duplicate IDs, and credential patterns.
9. Valid output becomes `PENDING_REVIEW`; invalid output fails closed as `FAILED`.
10. Human reviewer confirms tests and security before `APPROVED_FOR_GIT`.
11. Export creates proposed `SKILL.md` + registry entry; it does not write Git automatically.
12. After canonical Git registration, Skills Hub can create a dry-run distribution plan.

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
- Never auto-sync to Codex, Hermes, OpenCode, Antigravity, custom, or production directories.
- Extractor child process receives a sanitized environment and does not inherit Control Plane secrets.
- Never accept REA raw artifacts, credentials, private keys, personal data, cookies, or proprietary source as reusable skill content.
- Store no raw extractor output in the Candidate record after successful parsing.
- Every queue, extraction, failure, review, rejection, export workflow, and sync plan remains auditable.
- Worker and Bridge gates are independent and OFF in committed configuration.

## Distribution planning

Use the pinned Skills Hub adapter conventions for supported targets:

- Codex: `.codex/skills`
- OpenCode: `.config/opencode/skills`
- Antigravity global skills: `.gemini/antigravity/global_skills`
- Hermes: reviewed custom directory

The planner is dry-run only and must return `executed=false`.

## Acceptance tests

- Worker TypeScript check passes.
- Bridge syntax check passes.
- Skills Hub Guard passes.
- Deploy preflight confirms committed runtime gates remain OFF.
- Extractor cannot run unless Worker and Bridge staging gates are both enabled.
- Extractor rejects REA and extractor source tasks.
- Known credential patterns block automatic extraction before dispatch.
- Invalid JSON output fails closed.
- Duplicate canonical skill IDs fail closed.
- Candidate approval does not mutate canonical Git files.
- Sync plan never writes files and records `executed=0`.
