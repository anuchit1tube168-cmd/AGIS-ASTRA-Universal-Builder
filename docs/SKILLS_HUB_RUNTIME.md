# Skills Hub Runtime Integration

This phase uses the pinned Skills Hub source as a governed distribution reference while keeping all automatic writes disabled.

## What is added

### 1. Skill Candidate Inbox

Reusable patterns can be submitted by an approved local agent to:

`POST /internal/skill-candidate`

The endpoint is protected by `CALLBACK_TOKEN` and additionally requires:

- `APP_ENV=staging`
- `SKILL_CANDIDATE_INGEST_ENABLED=true`

Committed configuration keeps candidate ingest disabled.

A candidate must reference a completed normal task. REA Scout tasks and extractor tasks are rejected as automatic sources so raw analysis does not silently become reusable skill content.

### 2. Human review gate

Mission Control exposes:

- `GET /api/skills/candidates`
- `POST /api/skills/candidates/:id/review`
- `GET /api/skills/candidates/:id/export`

Approval requires explicit confirmation that tests and security review passed. Approval changes the candidate to `APPROVED_FOR_GIT`; it does not modify Git.

The export endpoint produces:

- proposed `SKILL.md`
- proposed `skills/registry.json` entry
- proposed canonical source path

These outputs still require a reviewed Git change and Skills Hub Guard.

### 3. Skills Hub dry-run sync planner

For skills at `REGISTRY_APPROVED` or later:

`POST /api/skills/:id/sync-plan`

The planner records a D1 plan with `executed=0` and never writes a tool directory.

Pinned Skills Hub adapter conventions used by the plan:

- Codex: `.codex/skills`
- OpenCode: `.config/opencode/skills`
- Antigravity global: `.gemini/antigravity/global_skills`
- Hermes: reviewed custom directory configured outside the registry

Recent plans are available at:

`GET /api/skills/sync-plans`

### 4. Dedicated Control Center

`/skills.html` provides:

- candidate inbox
- approve/reject review
- Git-material export inspector
- canonical skill registry view
- dry-run sync plan creation
- recent sync plan history

## Agent submission helper

An approved staging agent can submit a structured candidate using:

```bash
npm run skills:submit-candidate -- ./candidate.json
```

Environment required by the helper:

```bash
CONTROL_PLANE_URL=https://YOUR-WORKER.workers.dev
CALLBACK_TOKEN=<staging callback token>
```

Example candidate payload:

```json
{
  "sourceTaskId": "completed-task-id",
  "id": "advisor-booking-flow",
  "name": "Advisor Booking Flow",
  "version": "0.1.0",
  "owner": "ASTRA Skill Factory",
  "capability": "Build a reviewable advisor appointment flow.",
  "procedure": [
    "Validate the student identity server-side.",
    "Resolve advisor availability.",
    "Create an appointment record and audit event."
  ],
  "acceptance_tests": [
    "Unauthorized students cannot read another student's appointment.",
    "Double booking is rejected."
  ],
  "failure_modes": [
    "Stale availability cache can cause a booking conflict."
  ],
  "distribution_targets": ["codex", "hermes", "opencode"]
}
```

## Safety invariants

- Skills Hub auto-sync: OFF
- Production write: OFF
- Remote publish: OFF
- Candidate ingest: OFF in committed production config
- Candidate approval never writes Git
- Sync plan execution: always false
- Canonical registry: Git review only
- Distributed copies: outputs, never canonical

## Deployment order

Because this phase adds D1 tables and changes the Worker entrypoint, deploy in this order:

```bash
npm run skills:guard
npm run db:migrate
npm run check
npm run deploy
```

Do not deploy the new Worker before the D1 migration is applied.
