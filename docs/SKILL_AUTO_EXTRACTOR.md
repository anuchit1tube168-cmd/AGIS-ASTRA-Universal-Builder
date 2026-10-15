# ASTRA Skill Auto-Extractor

This phase closes the loop between completed AGIS × ASTRA work and the Skills Hub Candidate Inbox while keeping every canonical write review-gated.

## Runtime flow

```text
Completed Task
  -> operator clicks Extract Skill
  -> Worker credential pre-scan
  -> skill_candidates: EXTRACTING
  -> Queue
  -> Bridge recognizes skill-extractor:<sourceTaskId>
  -> isolated Hermes HOME/workspace + safe-mode
  -> strict JSON result
  -> Worker validation + duplicate check + credential scan
  -> skill_candidates: PENDING_REVIEW
  -> Human tests/security review
  -> APPROVED_FOR_GIT
  -> Export proposed SKILL.md + registry entry
  -> Git review + Skills Hub Guard
  -> REGISTRY_APPROVED+
  -> Dry-run sync plan
```

## New API

### List extractable completed tasks

`GET /api/skills/extractable-tasks`

Requires an authenticated admin session. It returns recent completed tasks that:

- are not REA tasks;
- are not extractor tasks;
- contain a non-trivial result;
- may not yet have a Skill Candidate.

### Start extraction

`POST /api/tasks/:taskId/extract-skill`

Requires:

- authenticated admin session;
- `APP_ENV=staging`;
- `SKILL_EXTRACTOR_ENABLED=true` on the Worker;
- `SKILL_EXTRACTOR_EXECUTION_ENABLED=true` on the Bridge;
- dedicated `SKILL_HERMES_HOME` and `SKILL_WORKSPACE_ROOT` paths on the Bridge.

The endpoint creates a linked Candidate with `EXTRACTING` status before queueing the task. It never creates or edits a canonical Skill file.

## Bridge isolation

Skill Extractor execution is not treated as a generic Hermes child. The Bridge infers the extractor runtime from the task source prefix and forces:

- dedicated HOME;
- dedicated workspace;
- sanitized environment;
- `--safe-mode`;
- a strict `SKILL_EXTRACTOR_SOURCE` prompt envelope;
- independent concurrency limit;
- independent execution gate.

The committed Bridge example keeps the execution gate OFF.

## Validation

Returned model output must be one JSON object containing:

- `id`
- `name`
- `version`
- `owner`
- `capability`
- `procedure[]`
- `acceptance_tests[]`
- `failure_modes[]`
- `distribution_targets[]`

The Worker validates:

- kebab-case ID;
- semantic version;
- array sizes and string lengths;
- allowed target names;
- duplicate canonical IDs;
- known credential patterns;
- total output size.

Malformed or suspicious output fails closed as `FAILED`.

## Safety invariants

- Production Worker extractor gate: OFF in committed config.
- Bridge extractor gate: OFF in committed example config.
- REA output is never automatically promoted into a Skill.
- Candidate remains `PENDING_REVIEW` until a human confirms tests and security review.
- Model output never writes `skills/registry.json`.
- Git export is proposed material only.
- Skills Hub distribution remains dry-run only.
- Production write remains OFF.
- Remote publish remains OFF.

## Deployment preparation

Run:

```bash
npm run skills:guard
npm run check
npm run deploy:preflight
```

`deploy:preflight` intentionally refuses deployment while the D1 ID is still a placeholder and refuses any deploy target other than staging.

After a staging D1/database and runtime configuration exist, the required order remains:

```text
1. guard
2. D1 migration
3. TypeScript check
4. deploy staging Worker
5. configure isolated Bridge directories
6. enable Worker extractor gate in staging only
7. enable Bridge extractor gate in staging only
8. run one controlled completed-task extraction
9. verify Candidate -> review -> export -> dry-run plan
```

Do not enable extractor or Skills Hub writes in production as part of this phase.
