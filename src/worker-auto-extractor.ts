import skillsRuntime from "./worker-skills";

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
  SKILL_EXTRACTOR_ENABLED?: string;
}

type ExtractorResult = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  owner?: unknown;
  capability?: unknown;
  procedure?: unknown;
  acceptance_tests?: unknown;
  failure_modes?: unknown;
  distribution_targets?: unknown;
};

const enc = new TextEncoder();
const candidateIdPattern = /^[a-z0-9][a-z0-9-]{1,79}$/;
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const allowedTargets = new Set(["codex", "hermes", "opencode", "antigravity", "custom"]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/
];

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

function extractorAvailable(env: Env) {
  return env.APP_ENV === "staging" && env.SKILL_EXTRACTOR_ENABLED === "true";
}

function containsSecretMaterial(value: string) {
  return secretPatterns.some((pattern) => pattern.test(value));
}

function stringArray(value: unknown, label: string, maxItems = 50, maxLength = 1000) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  if (items.length === 0 || items.length > maxItems) throw new Error(`${label} has invalid item count`);
  if (items.some((item) => item.length > maxLength)) throw new Error(`${label} item is too long`);
  return items;
}

function distributionTargets(value: unknown) {
  const items = stringArray(value, "distribution_targets", 10, 64).map((item) => item.toLowerCase());
  if (items.some((item) => !allowedTargets.has(item))) throw new Error("unsupported distribution target");
  return [...new Set(items)];
}

function stripCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseExtractorResult(raw: string) {
  if (!raw || raw.length > 100_000) throw new Error("extractor output is empty or too large");
  if (containsSecretMaterial(raw)) throw new Error("extractor output contains possible credential material");
  let parsed: ExtractorResult;
  try {
    parsed = JSON.parse(stripCodeFence(raw)) as ExtractorResult;
  } catch {
    throw new Error("extractor output must be a single JSON object");
  }
  const id = String(parsed.id || "").trim().toLowerCase();
  const name = String(parsed.name || "").trim().slice(0,160);
  const version = String(parsed.version || "0.1.0").trim();
  const owner = String(parsed.owner || "ASTRA Skill Factory").trim().slice(0,160);
  const capability = String(parsed.capability || "").trim().slice(0,4000);
  if (!candidateIdPattern.test(id) || !name || !semverPattern.test(version) || !owner || !capability) {
    throw new Error("extractor output has invalid skill metadata");
  }
  return {
    id,
    name,
    version,
    owner,
    capability,
    procedure:stringArray(parsed.procedure, "procedure"),
    acceptanceTests:stringArray(parsed.acceptance_tests, "acceptance_tests"),
    failureModes:stringArray(parsed.failure_modes, "failure_modes"),
    targets:distributionTargets(parsed.distribution_targets)
  };
}

function buildExtractorPrompt(sourceTaskId: string, command: string, result: string) {
  const sourceCommand = command.slice(0, 1800);
  const sourceResult = result.slice(0, 12_000);
  return [
    `SKILL_EXTRACTOR_SOURCE ${sourceTaskId}`,
    "You are ASTRA Skill Extractor. Extract only a reusable, generalizable procedure from the completed task below.",
    "Do not copy secrets, credentials, personal data, private assets, proprietary source, one-off identifiers, or environment-specific tokens.",
    "Do not claim a test or security property that is not supported by the completed task evidence.",
    "Return exactly one JSON object and no prose or Markdown fence.",
    "Required schema:",
    '{"id":"kebab-case-id","name":"Human Name","version":"0.1.0","owner":"ASTRA Skill Factory","capability":"what this reusable skill does","procedure":["step"],"acceptance_tests":["test"],"failure_modes":["known failure"],"distribution_targets":["codex","hermes","opencode"]}',
    "Use only these distribution targets when appropriate: codex, hermes, opencode, antigravity, custom.",
    "If the work is not reusable or evidence is insufficient, return a valid JSON object whose id starts with 'reject-' and explain the reason in capability and failure_modes. Human review will decide whether to keep it.",
    "",
    "SOURCE TASK COMMAND:",
    sourceCommand,
    "",
    "SOURCE TASK RESULT:",
    sourceResult
  ].join("\n").slice(0, 19_000);
}

async function listExtractableTasks(req: Request, env: Env) {
  if (!(await validSession(req, env))) return json({error:"unauthorized"}, 401);
  const rows = await env.DB.prepare(`
    SELECT t.id,t.command,t.source,t.status,t.created_at,t.updated_at,
           LENGTH(COALESCE(t.result,'')) AS result_length,
           c.id AS candidate_id,c.status AS candidate_status,
           (SELECT e.status FROM tasks e WHERE e.source=('skill-extractor:' || t.id) ORDER BY e.created_at DESC LIMIT 1) AS extractor_status
    FROM tasks t
    LEFT JOIN skill_candidates c ON c.source_task_id=t.id
    WHERE t.status='completed'
      AND t.source <> 'rea-scout'
      AND t.source NOT LIKE 'skill-extractor:%'
      AND LENGTH(COALESCE(t.result,'')) >= 20
    ORDER BY t.updated_at DESC
    LIMIT 50
  `).all();
  return json({
    tasks:rows.results,
    extractor:{enabled:extractorAvailable(env),appEnv:env.APP_ENV || "unknown"},
    policy:{human_review_required:true,canonical_write:false,auto_sync:false,production_write:false}
  });
}

async function queueExtraction(req: Request, env: Env, sourceTaskId: string) {
  if (!(await validSession(req, env))) return json({error:"unauthorized"}, 401);
  if (!extractorAvailable(env)) return json({error:"skill extractor is enabled only in staging"}, 409);

  const sourceTask = await env.DB.prepare(
    "SELECT id,command,source,status,result FROM tasks WHERE id=?"
  ).bind(sourceTaskId).first() as {id:string;command:string;source:string;status:string;result:string|null} | null;
  if (!sourceTask) return json({error:"source task not found"}, 404);
  if (sourceTask.status !== "completed" || !sourceTask.result || sourceTask.result.length < 20) {
    return json({error:"source task must be completed with a result"}, 409);
  }
  if (sourceTask.source === "rea-scout" || sourceTask.source.startsWith("skill-extractor:")) {
    return json({error:"source task type is not eligible for automatic extraction"}, 409);
  }
  if (containsSecretMaterial(sourceTask.command) || containsSecretMaterial(sourceTask.result)) {
    await audit(env, "web", "skill_extraction_blocked_secret_scan", sourceTaskId);
    return json({error:"source task contains possible credential material; automatic extraction blocked"}, 409);
  }

  const existingCandidate = await env.DB.prepare(
    "SELECT id,status,extractor_task_id FROM skill_candidates WHERE source_task_id=?"
  ).bind(sourceTaskId).first() as {id:string;status:string;extractor_task_id:string|null} | null;
  if (existingCandidate) {
    return json({error:"skill candidate already exists for source task",candidateId:existingCandidate.id,status:existingCandidate.status}, 409);
  }

  const extractorSource = `skill-extractor:${sourceTaskId}`;
  const activeJob = await env.DB.prepare(
    "SELECT id,status FROM tasks WHERE source=? AND status IN ('queued','dispatching','running','retrying') ORDER BY created_at DESC LIMIT 1"
  ).bind(extractorSource).first() as {id:string;status:string} | null;
  if (activeJob) return json({error:"extraction already in progress",extractorTaskId:activeJob.id,status:activeJob.status}, 409);

  const extractorTaskId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  const prompt = buildExtractorPrompt(sourceTaskId, sourceTask.command, sourceTask.result);

  await env.DB.prepare(
    "INSERT INTO tasks(id,command,source,status) VALUES(?,?,?,'queued')"
  ).bind(extractorTaskId, prompt, extractorSource).run();
  await env.DB.prepare(`
    INSERT INTO skill_candidates(
      id,source_task_id,extractor_task_id,status,test_status,security_status
    ) VALUES(?,?,?,'EXTRACTING','PENDING','PENDING')
  `).bind(candidateId, sourceTaskId, extractorTaskId).run();

  try {
    await env.TASK_QUEUE.send({
      taskId:extractorTaskId,
      command:prompt,
      source:extractorSource,
      kind:"generic"
    });
  } catch (err) {
    const message = String(err).slice(0,1000);
    await env.DB.prepare("UPDATE tasks SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message, extractorTaskId).run();
    await env.DB.prepare("UPDATE skill_candidates SET status='FAILED',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message, candidateId).run();
    await audit(env, "web", "skill_extraction_queue_failed", sourceTaskId, message);
    return json({error:"failed to queue skill extraction",detail:message}, 500);
  }

  await audit(env, "web", "skill_extraction_queued", sourceTaskId, `extractor_task=${extractorTaskId}; candidate=${candidateId}`);
  return json({
    ok:true,
    sourceTaskId,
    extractorTaskId,
    candidateId,
    status:"EXTRACTING",
    human_review_required:true,
    canonical_write:false,
    auto_sync:false
  }, 202);
}

async function handleExtractorCallback(req: Request, env: Env): Promise<Response | null> {
  if (req.method !== "POST") return null;
  if (bearer(req) !== env.CALLBACK_TOKEN || !env.CALLBACK_TOKEN || env.CALLBACK_TOKEN.length < 24) {
    return json({error:"unauthorized"}, 401);
  }
  const clone = req.clone();
  const body = await clone.json().catch(()=>({})) as {taskId?:string;status?:string;result?:string;error?:string};
  const taskId = String(body.taskId || "").trim();
  if (!taskId) return null;
  const task = await env.DB.prepare(
    "SELECT id,source FROM tasks WHERE id=?"
  ).bind(taskId).first() as {id:string;source:string} | null;
  if (!task || !task.source.startsWith("skill-extractor:")) return null;

  const sourceTaskId = task.source.slice("skill-extractor:".length);
  const candidate = await env.DB.prepare(
    "SELECT id,status FROM skill_candidates WHERE extractor_task_id=? AND source_task_id=?"
  ).bind(taskId, sourceTaskId).first() as {id:string;status:string} | null;
  if (!candidate) {
    await env.DB.prepare(
      "UPDATE tasks SET status='failed',error='missing extraction candidate envelope',updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(taskId).run();
    await audit(env, "skill-extractor", "skill_extraction_orphaned", sourceTaskId, `extractor_task=${taskId}`);
    return json({error:"missing extraction candidate envelope"}, 409);
  }

  const rawResult = String(body.result || "");
  const rawError = String(body.error || "").slice(0,10_000);
  if (body.status !== "completed") {
    await env.DB.prepare(
      "UPDATE tasks SET status='failed',result=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(rawResult.slice(0,100_000), rawError || "extractor task failed", taskId).run();
    await env.DB.prepare(
      "UPDATE skill_candidates SET status='FAILED',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(rawError || "extractor task failed", candidate.id).run();
    await audit(env, "skill-extractor", "skill_extraction_failed", candidate.id, rawError || `extractor_task=${taskId}`);
    return json({ok:true,candidateId:candidate.id,status:"FAILED"});
  }

  try {
    const parsed = parseExtractorResult(rawResult);
    const duplicate = await env.DB.prepare(
      "SELECT id FROM skill_catalog WHERE id=?"
    ).bind(parsed.id).first();
    if (duplicate) throw new Error("extracted skill id already exists in canonical catalog");

    await env.DB.prepare(
      "UPDATE tasks SET status='completed',result=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(rawResult.slice(0,100_000), taskId).run();
    await env.DB.prepare(`
      UPDATE skill_candidates SET
        suggested_id=?,name=?,version=?,owner=?,capability=?,procedure_json=?,acceptance_tests_json=?,
        failure_modes_json=?,distribution_targets=?,status='PENDING_REVIEW',raw_output=NULL,error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND extractor_task_id=?
    `).bind(
      parsed.id,parsed.name,parsed.version,parsed.owner,parsed.capability,
      JSON.stringify(parsed.procedure),JSON.stringify(parsed.acceptanceTests),JSON.stringify(parsed.failureModes),JSON.stringify(parsed.targets),
      candidate.id,taskId
    ).run();
    await audit(env, "skill-extractor", "skill_candidate_extracted", candidate.id, `source_task=${sourceTaskId}; extractor_task=${taskId}; suggested_id=${parsed.id}`);
    return json({
      ok:true,
      candidateId:candidate.id,
      status:"PENDING_REVIEW",
      human_review_required:true,
      canonical_write:false,
      auto_sync:false
    });
  } catch (err) {
    const message = String(err).slice(0,2000);
    await env.DB.prepare(
      "UPDATE tasks SET status='failed',result=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(rawResult.slice(0,100_000), message, taskId).run();
    await env.DB.prepare(
      "UPDATE skill_candidates SET status='FAILED',raw_output=NULL,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(message, candidate.id).run();
    await audit(env, "skill-extractor", "skill_extraction_invalid_output", candidate.id, message);
    return json({ok:true,candidateId:candidate.id,status:"FAILED",error:message});
  }
}

async function fetchHandler(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/api/skills/extractable-tasks" && req.method === "GET") {
    return listExtractableTasks(req, env);
  }

  const extractMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/extract-skill$/);
  if (extractMatch && req.method === "POST") {
    let sourceTaskId = extractMatch[1];
    try { sourceTaskId = decodeURIComponent(sourceTaskId); } catch {}
    return queueExtraction(req, env, sourceTaskId);
  }

  if (url.pathname === "/internal/task-result") {
    const handled = await handleExtractorCallback(req, env);
    if (handled) return handled;
  }

  return skillsRuntime.fetch(req, env as never, ctx);
}

async function queueHandler(batch: MessageBatch<unknown>, env: Env) {
  return skillsRuntime.queue(batch as never, env as never);
}

export default {
  fetch: fetchHandler,
  queue: queueHandler,
} satisfies ExportedHandler<Env, unknown>;
