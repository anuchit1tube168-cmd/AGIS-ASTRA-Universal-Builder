import core from "./worker";

interface Env {
  DB: D1Database;
  TASK_QUEUE: Queue<unknown>;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  BRIDGE_URL: string;
  BRIDGE_TOKEN: string;
  CALLBACK_TOKEN: string;
  SESSION_TTL_SECONDS?: string;
  APP_ENV?: string;
  REA_RUNTIME_ENABLED?: string;
  SKILL_CANDIDATE_INGEST_ENABLED?: string;
}

type CandidateBody = {
  sourceTaskId?: string;
  id?: string;
  name?: string;
  version?: string;
  owner?: string;
  capability?: string;
  procedure?: unknown;
  acceptance_tests?: unknown;
  failure_modes?: unknown;
  distribution_targets?: unknown;
};

const enc = new TextEncoder();
const candidateIdPattern = /^[a-z0-9][a-z0-9-]{1,79}$/;
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const allowedTargets = new Set(["codex", "hermes", "opencode", "antigravity", "custom"]);
const skillStates = [
  "DRAFT",
  "VALIDATED",
  "SECURITY_REVIEWED",
  "REGISTRY_APPROVED",
  "STAGING_SYNC",
  "VERIFIED",
  "PRODUCTION_APPROVED"
] as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8"},
  });
}

function bearer(req: Request) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function cookies(req: Request) {
  const out: Record<string,string> = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0,idx).trim()] = decodeURIComponent(part.slice(idx+1));
  }
  return out;
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function validSession(req: Request, env: Env) {
  const token = cookies(req).agis_session;
  if (!token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || exp < Math.floor(Date.now()/1000)) return false;
  return sig === await hmac(env.SESSION_SECRET, expRaw);
}

async function audit(env: Env, actor: string, action: string, target = "", detail = "") {
  await env.DB.prepare(
    "INSERT INTO audit_log(actor,action,target,detail) VALUES(?,?,?,?)"
  ).bind(actor, action, target, detail.slice(0,4000)).run();
}

function candidateIngestAvailable(env: Env) {
  return env.APP_ENV === "staging" && env.SKILL_CANDIDATE_INGEST_ENABLED === "true";
}

function stringArray(value: unknown, label: string, maxItems = 50, maxLength = 1000) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  if (items.length === 0 || items.length > maxItems) throw new Error(`${label} has invalid item count`);
  if (items.some((item) => item.length > maxLength)) throw new Error(`${label} item is too long`);
  return items;
}

function targets(value: unknown) {
  const items = stringArray(value, "distribution_targets", 10, 64).map((item) => item.toLowerCase());
  if (items.some((item) => !allowedTargets.has(item))) throw new Error("unsupported distribution target");
  return [...new Set(items)];
}

function decodeArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function skillIndex(state: string) {
  return skillStates.indexOf(state as typeof skillStates[number]);
}

function syncAdapter(target: string, skillId: string) {
  if (target === "codex") return {
    target,
    adapter:"skills-hub:codex",
    scope:"global",
    relative_skills_dir:".codex/skills",
    destination_hint:`~/.codex/skills/${skillId}`,
    requires_config:false,
    execute:false
  };
  if (target === "opencode") return {
    target,
    adapter:"skills-hub:opencode",
    scope:"global",
    relative_skills_dir:".config/opencode/skills",
    destination_hint:`~/.config/opencode/skills/${skillId}`,
    requires_config:false,
    execute:false
  };
  if (target === "antigravity") return {
    target,
    adapter:"skills-hub:antigravity",
    scope:"global",
    relative_skills_dir:".gemini/antigravity/global_skills",
    destination_hint:`~/.gemini/antigravity/global_skills/${skillId}`,
    requires_config:false,
    execute:false
  };
  if (target === "hermes") return {
    target,
    adapter:"skills-hub:custom-directory",
    scope:"configured",
    relative_skills_dir:null,
    destination_hint:`<HERMES_SKILLS_DIR>/${skillId}`,
    requires_config:true,
    execute:false
  };
  return {
    target,
    adapter:"skills-hub:custom-directory",
    scope:"configured",
    relative_skills_dir:null,
    destination_hint:`<CUSTOM_SKILLS_DIR>/${skillId}`,
    requires_config:true,
    execute:false
  };
}

function markdownList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

async function handleCandidateIngest(req: Request, env: Env) {
  if (bearer(req) !== env.CALLBACK_TOKEN || !env.CALLBACK_TOKEN || env.CALLBACK_TOKEN.length < 24) {
    return json({error:"unauthorized"}, 401);
  }
  if (!candidateIngestAvailable(env)) {
    return json({error:"skill candidate ingest is enabled only in staging"}, 409);
  }

  const body = await req.json().catch(()=>({})) as CandidateBody;
  const sourceTaskId = String(body.sourceTaskId || "").trim();
  const suggestedId = String(body.id || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0,160);
  const version = String(body.version || "0.1.0").trim();
  const owner = String(body.owner || "ASTRA Skill Factory").trim().slice(0,160);
  const capability = String(body.capability || "").trim().slice(0,4000);
  if (!sourceTaskId || !candidateIdPattern.test(suggestedId) || !name || !semverPattern.test(version) || !owner || !capability) {
    return json({error:"invalid candidate metadata"}, 400);
  }

  let procedure: string[];
  let acceptanceTests: string[];
  let failureModes: string[];
  let distributionTargets: string[];
  try {
    procedure = stringArray(body.procedure, "procedure");
    acceptanceTests = stringArray(body.acceptance_tests, "acceptance_tests");
    failureModes = stringArray(body.failure_modes, "failure_modes");
    distributionTargets = targets(body.distribution_targets);
  } catch (err) {
    return json({error:String(err)}, 400);
  }

  const sourceTask = await env.DB.prepare(
    "SELECT id,source,status,LENGTH(COALESCE(result,'')) AS result_length FROM tasks WHERE id=?"
  ).bind(sourceTaskId).first() as {id:string;source:string;status:string;result_length:number} | null;
  if (!sourceTask) return json({error:"source task not found"}, 404);
  if (sourceTask.status !== "completed" || Number(sourceTask.result_length || 0) < 20) {
    return json({error:"source task must be completed with a result"}, 409);
  }
  if (["rea-scout","skill-extractor"].includes(sourceTask.source)) {
    return json({error:"source task type is not eligible for automatic skill candidate ingest"}, 409);
  }

  const existing = await env.DB.prepare(
    "SELECT id,status FROM skill_candidates WHERE source_task_id=?"
  ).bind(sourceTaskId).first() as {id:string;status:string} | null;
  if (existing) return json({error:"candidate already exists for source task", candidateId:existing.id, status:existing.status}, 409);

  const candidateId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO skill_candidates(
      id,source_task_id,suggested_id,name,version,owner,capability,
      procedure_json,acceptance_tests_json,failure_modes_json,distribution_targets,
      status,test_status,security_status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'PENDING_REVIEW','PENDING','PENDING')
  `).bind(
    candidateId, sourceTaskId, suggestedId, name, version, owner, capability,
    JSON.stringify(procedure), JSON.stringify(acceptanceTests), JSON.stringify(failureModes), JSON.stringify(distributionTargets)
  ).run();
  await audit(env, "skill-extractor", "skill_candidate_ingested", candidateId, `source_task=${sourceTaskId}; suggested_id=${suggestedId}`);
  return json({ok:true,candidateId,status:"PENDING_REVIEW",canonical_write:false,auto_sync:false}, 201);
}

async function handleSkillsApi(req: Request, env: Env, url: URL): Promise<Response | null> {
  const isSkillRuntimePath =
    url.pathname === "/api/skills/candidates" ||
    url.pathname === "/api/skills/sync-plans" ||
    /^\/api\/skills\/candidates\/[^/]+\/(?:review|export)$/.test(url.pathname) ||
    /^\/api\/skills\/[^/]+\/sync-plan$/.test(url.pathname);
  if (!isSkillRuntimePath) return null;
  if (!(await validSession(req, env))) return json({error:"unauthorized"}, 401);

  if (url.pathname === "/api/skills/candidates" && req.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT id,source_task_id,extractor_task_id,suggested_id,name,version,owner,capability,
             procedure_json,acceptance_tests_json,failure_modes_json,distribution_targets,
             status,test_status,security_status,review_note,error,created_at,updated_at
      FROM skill_candidates ORDER BY created_at DESC LIMIT 100
    `).all();
    const candidates = (rows.results as Record<string,unknown>[]).map((row) => ({
      ...row,
      procedure:decodeArray(String(row.procedure_json || "[]")),
      acceptance_tests:decodeArray(String(row.acceptance_tests_json || "[]")),
      failure_modes:decodeArray(String(row.failure_modes_json || "[]")),
      distribution_targets:decodeArray(String(row.distribution_targets || "[]")),
      procedure_json:undefined,
      acceptance_tests_json:undefined,
      failure_modes_json:undefined
    }));
    return json({
      candidates,
      ingest:{enabled:candidateIngestAvailable(env),appEnv:env.APP_ENV || "unknown"},
      policy:{canonical_write:false,auto_sync:false,production_write:false}
    });
  }

  const reviewMatch = url.pathname.match(/^\/api\/skills\/candidates\/([^/]+)\/review$/);
  if (reviewMatch && req.method === "POST") {
    let candidateId = reviewMatch[1];
    try { candidateId = decodeURIComponent(candidateId); } catch {}
    const body = await req.json().catch(()=>({})) as {action?:string;tests_confirmed?:boolean;security_review_passed?:boolean;note?:string};
    const row = await env.DB.prepare(
      "SELECT id,status,suggested_id FROM skill_candidates WHERE id=?"
    ).bind(candidateId).first() as {id:string;status:string;suggested_id:string} | null;
    if (!row) return json({error:"candidate not found"}, 404);
    if (row.status !== "PENDING_REVIEW") return json({error:`candidate cannot be reviewed from ${row.status}`}, 409);
    const note = String(body.note || "").trim().slice(0,2000);
    if (body.action === "reject") {
      await env.DB.prepare(
        "UPDATE skill_candidates SET status='REJECTED',review_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING_REVIEW'"
      ).bind(note, candidateId).run();
      await audit(env, "web", "skill_candidate_rejected", candidateId, note);
      return json({ok:true,candidateId,status:"REJECTED",canonical_write:false});
    }
    if (body.action !== "approve" || body.tests_confirmed !== true || body.security_review_passed !== true) {
      return json({error:"approval requires tests_confirmed and security_review_passed"}, 409);
    }
    const duplicate = await env.DB.prepare(
      "SELECT id FROM skill_catalog WHERE id=?"
    ).bind(row.suggested_id).first();
    if (duplicate) return json({error:"suggested skill id already exists in catalog"}, 409);
    await env.DB.prepare(`
      UPDATE skill_candidates
      SET status='APPROVED_FOR_GIT',test_status='PASS',security_status='PASS',review_note=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='PENDING_REVIEW'
    `).bind(note, candidateId).run();
    await audit(env, "web", "skill_candidate_approved_for_git", candidateId, `suggested_id=${row.suggested_id}${note ? `; ${note}` : ""}`);
    return json({
      ok:true,candidateId,status:"APPROVED_FOR_GIT",
      next:"export candidate and create a reviewed Git change",
      canonical_write:false,auto_sync:false
    });
  }

  const exportMatch = url.pathname.match(/^\/api\/skills\/candidates\/([^/]+)\/export$/);
  if (exportMatch && req.method === "GET") {
    let candidateId = exportMatch[1];
    try { candidateId = decodeURIComponent(candidateId); } catch {}
    const row = await env.DB.prepare(`
      SELECT id,suggested_id,name,version,owner,capability,procedure_json,acceptance_tests_json,
             failure_modes_json,distribution_targets,status,test_status,security_status
      FROM skill_candidates WHERE id=?
    `).bind(candidateId).first() as Record<string,unknown> | null;
    if (!row) return json({error:"candidate not found"}, 404);
    if (row.status !== "APPROVED_FOR_GIT") return json({error:"candidate must be APPROVED_FOR_GIT before export"}, 409);
    const id = String(row.suggested_id);
    const procedure = decodeArray(String(row.procedure_json));
    const acceptanceTests = decodeArray(String(row.acceptance_tests_json));
    const failureModes = decodeArray(String(row.failure_modes_json));
    const distributionTargets = decodeArray(String(row.distribution_targets));
    const sourcePath = `skills/generated/${id}/SKILL.md`;
    const skillMd = [
      `# ${row.name}`,
      "",
      "Status: DRAFT",
      `Version: ${row.version}`,
      `Owner: ${row.owner}`,
      "",
      "## Capability",
      "",
      String(row.capability),
      "",
      "## Procedure",
      "",
      markdownList(procedure),
      "",
      "## Acceptance tests",
      "",
      markdownList(acceptanceTests),
      "",
      "## Known failure modes",
      "",
      markdownList(failureModes),
      "",
      "## Distribution targets",
      "",
      markdownList(distributionTargets),
      "",
      "## Safety",
      "",
      "- This artifact was generated from an approved Skill Candidate.",
      "- Canonical registration still requires Git review and Skills Hub Guard.",
      "- No auto-sync or production write is authorized by this file."
    ].join("\n");
    return json({
      candidateId,
      source_path:sourcePath,
      skill_md:skillMd,
      registry_entry:{
        id,
        name:String(row.name),
        version:String(row.version),
        owner:String(row.owner),
        source_path:sourcePath,
        state:"DRAFT",
        test_status:"PASS",
        security_status:"PASS",
        security_reviewed:true,
        distribution_targets:distributionTargets,
        production_approved:false
      },
      canonical_write:false
    });
  }

  if (url.pathname === "/api/skills/sync-plans" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,skill_id,mode,state_snapshot,plan_json,executed,created_at FROM skill_sync_plans ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({plans:(rows.results as Record<string,unknown>[]).map((row)=>({...row,plan:JSON.parse(String(row.plan_json || "[]")),plan_json:undefined}))});
  }

  const planMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/sync-plan$/);
  if (planMatch && req.method === "POST") {
    let skillId = planMatch[1];
    try { skillId = decodeURIComponent(skillId); } catch {}
    const row = await env.DB.prepare(
      "SELECT id,name,state,distribution_targets,source_path FROM skill_catalog WHERE id=?"
    ).bind(skillId).first() as {id:string;name:string;state:string;distribution_targets:string;source_path:string} | null;
    if (!row) return json({error:"skill not found"}, 404);
    if (skillIndex(row.state) < skillIndex("REGISTRY_APPROVED")) {
      return json({error:"sync planning requires REGISTRY_APPROVED or later"}, 409);
    }
    const distributionTargets = decodeArray(row.distribution_targets);
    const plan = distributionTargets.map((target) => syncAdapter(target, skillId));
    const planId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO skill_sync_plans(id,skill_id,mode,state_snapshot,plan_json,executed) VALUES(?,?,'dry-run',?,?,0)"
    ).bind(planId, skillId, row.state, JSON.stringify(plan)).run();
    await audit(env, "web", "skill_sync_plan_created", skillId, `plan=${planId}; targets=${distributionTargets.join(',')}; executed=false`);
    return json({
      ok:true,planId,skill:{id:row.id,name:row.name,state:row.state,source_path:row.source_path},
      mode:"dry-run",plan,executed:false,auto_sync:false,production_write:false
    }, 201);
  }

  return json({error:"method not allowed"}, 405);
}

async function fetchHandler(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/internal/skill-candidate" && req.method === "POST") {
    return handleCandidateIngest(req, env);
  }
  const skillResponse = await handleSkillsApi(req, env, url);
  if (skillResponse) return skillResponse;
  return core.fetch(req, env as never);
}

async function queueHandler(batch: MessageBatch<unknown>, env: Env) {
  return core.queue(batch as never, env as never);
}

export default {
  fetch: fetchHandler,
  queue: queueHandler,
} satisfies ExportedHandler<Env, unknown>;
