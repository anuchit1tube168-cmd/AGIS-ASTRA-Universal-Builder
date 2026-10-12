interface Env {
  DB: D1Database;
  TASK_QUEUE: Queue<TaskMessage>;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  BRIDGE_URL: string;
  BRIDGE_TOKEN: string;
  CALLBACK_TOKEN: string;
  SESSION_TTL_SECONDS?: string;
  APP_ENV?: string;
  REA_RUNTIME_ENABLED?: string;
}

interface TaskMessage {
  taskId: string;
  command: string;
  source: string;
  kind?: "generic" | "rea-scout";
  caseId?: string;
}

interface ReaCaseRow {
  id: string;
  task_id: string | null;
  name: string;
  target_reference: string;
  target_type: string;
  scope: string;
  authorization_confirmed: number;
  environment: string;
  production_write: number;
  status: string;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const enc = new TextEncoder();
const reaTargetTypes = new Set(["web", "electron", "android", "dotnet", "native", "other"]);

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8", ...headers},
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

async function makeSession(env: Env) {
  const ttl = Number(env.SESSION_TTL_SECONDS || "43200");
  const exp = Math.floor(Date.now()/1000) + ttl;
  return `${exp}.${await hmac(env.SESSION_SECRET, String(exp))}`;
}

async function validSession(req: Request, env: Env) {
  const token = cookies(req).agis_session;
  if (!token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || exp < Math.floor(Date.now()/1000)) return false;
  const expected = await hmac(env.SESSION_SECRET, expRaw);
  return sig === expected;
}

async function audit(env: Env, actor: string, action: string, target = "", detail = "") {
  await env.DB.prepare(
    "INSERT INTO audit_log(actor,action,target,detail) VALUES(?,?,?,?)"
  ).bind(actor, action, target, detail.slice(0,4000)).run();
}

async function reaEvent(env: Env, caseId: string, event: string, detail = "") {
  await env.DB.prepare(
    "INSERT INTO rea_events(case_id,event,detail) VALUES(?,?,?)"
  ).bind(caseId, event, detail.slice(0,4000)).run();
}

async function protectedApi(req: Request, env: Env) {
  if (!(await validSession(req, env))) return json({error:"unauthorized"}, 401);
  return null;
}

function reaRuntimeAvailable(env: Env) {
  return env.APP_ENV === "staging" && env.REA_RUNTIME_ENABLED === "true";
}

function sanitizeTargetReference(value: string) {
  const raw = value.trim();
  if (!raw) return "REDACTED_OR_NOT_SET";
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return "REDACTED_NON_HTTP_TARGET";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 512);
  } catch {
    if (/(?:token|secret|password|api[_-]?key|session|signature)\s*[=:]/i.test(raw)) {
      return "REDACTED_SENSITIVE_REFERENCE";
    }
    return raw.slice(0, 256);
  }
}

function buildReaCommand(row: ReaCaseRow) {
  return [
    `REA_SCOUT_CASE ${row.id}`,
    "This is an authorized, staging-only REA Scout investigation.",
    `Target type: ${row.target_type}`,
    `Target reference: ${row.target_reference}`,
    `Authorized scope: ${row.scope}`,
    "Use the REA skill and available REA tools only within this scope.",
    "Do not bypass authentication, DRM, anti-cheat, licensing, or access controls.",
    "Do not collect credentials, personal data, private assets, or proprietary source code.",
    "Do not write to production systems. Treat unknown binaries as untrusted and require external isolation.",
    "Return evidence-backed observations, architecture, feature map, risks, and a clean-room implementation plan.",
    "If evidence is insufficient, say what is missing rather than guessing."
  ].join("\n");
}

async function getReaCase(env: Env, caseId: string) {
  return await env.DB.prepare(
    "SELECT id,task_id,name,target_reference,target_type,scope,authorization_confirmed,environment,production_write,status,result,error,created_at,updated_at FROM rea_cases WHERE id=?"
  ).bind(caseId).first() as ReaCaseRow | null;
}

async function queueReaCase(env: Env, caseId: string, actor: string) {
  if (!reaRuntimeAvailable(env)) throw new Error("REA runtime is disabled unless APP_ENV=staging and REA_RUNTIME_ENABLED=true");
  const row = await getReaCase(env, caseId);
  if (!row) throw new Error("REA case not found");
  if (row.authorization_confirmed !== 1) throw new Error("REA authorization is not confirmed");
  if (row.environment !== "staging-only" || row.production_write !== 0) throw new Error("REA case violates staging policy");
  if (["queued", "dispatching", "running"].includes(row.status)) throw new Error(`REA case is already ${row.status}`);

  const taskId = crypto.randomUUID();
  const command = buildReaCommand(row);
  await env.DB.prepare(
    "INSERT INTO tasks(id,command,source,status) VALUES(?,?,?,'queued')"
  ).bind(taskId, command, "rea-scout").run();
  await env.DB.prepare(
    "UPDATE rea_cases SET task_id=?,status='queued',result=NULL,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(taskId, caseId).run();
  await reaEvent(env, caseId, "queued", `task=${taskId}`);

  try {
    await env.TASK_QUEUE.send({taskId, command, source:"rea-scout", kind:"rea-scout", caseId});
  } catch (err) {
    const message = String(err).slice(0,1000);
    await env.DB.prepare(
      "UPDATE tasks SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(message, taskId).run();
    await env.DB.prepare(
      "UPDATE rea_cases SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(message, caseId).run();
    await reaEvent(env, caseId, "queue_failed", message);
    throw err;
  }

  await audit(env, actor, "rea_case_queued", caseId, `task=${taskId}`);
  return taskId;
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await req.json().catch(()=>({})) as {password?: string};
    if (!body.password || body.password !== env.ADMIN_PASSWORD) {
      await audit(env, "web", "login_failed");
      return json({error:"invalid credentials"}, 401);
    }
    const token = await makeSession(env);
    await audit(env, "web", "login_success");
    return json({ok:true}, 200, {
      "set-cookie": `agis_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${env.SESSION_TTL_SECONDS || "43200"}`
    });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    return json({ok:true}, 200, {
      "set-cookie":"agis_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
    });
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    return json({authenticated: await validSession(req, env)});
  }

  const denied = await protectedApi(req, env);
  if (denied) return denied;

  if (url.pathname === "/api/status" && req.method === "GET") {
    const tasks = await env.DB.prepare(
      "SELECT status, COUNT(*) AS count FROM tasks GROUP BY status"
    ).all();
    const heartbeat = await env.DB.prepare(
      "SELECT runtime_id,state,detail,last_seen FROM runtime_heartbeat ORDER BY last_seen DESC"
    ).all();
    const agents = await env.DB.prepare(
      "SELECT id,name,status,capability,updated_at FROM agents ORDER BY name"
    ).all();
    const reaCases = await env.DB.prepare(
      "SELECT status, COUNT(*) AS count FROM rea_cases GROUP BY status"
    ).all();
    return json({
      tasks:tasks.results,
      heartbeat:heartbeat.results,
      agents:agents.results,
      reaCases:reaCases.results,
      reaRuntime:{enabled:reaRuntimeAvailable(env), appEnv:env.APP_ENV || "unknown"}
    });
  }

  if (url.pathname === "/api/tasks" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,command,source,status,result,error,created_at,updated_at FROM tasks ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({tasks:rows.results});
  }

  if (url.pathname === "/api/tasks" && req.method === "POST") {
    const body = await req.json().catch(()=>({})) as {command?: string};
    const command = (body.command || "").trim();
    if (!command || command.length > 20000) return json({error:"invalid command"}, 400);
    const taskId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO tasks(id,command,source,status) VALUES(?,?,?,'queued')"
    ).bind(taskId, command, "web").run();
    await env.TASK_QUEUE.send({taskId, command, source:"web", kind:"generic"});
    await audit(env, "web", "task_queued", taskId, command);
    return json({ok:true, taskId}, 202);
  }

  if (url.pathname === "/api/rea/cases" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,task_id,name,target_reference,target_type,scope,authorization_confirmed,environment,production_write,status,result,error,created_at,updated_at FROM rea_cases ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({cases:rows.results, runtime:{enabled:reaRuntimeAvailable(env), appEnv:env.APP_ENV || "unknown"}});
  }

  if (url.pathname === "/api/rea/cases" && req.method === "POST") {
    const body = await req.json().catch(()=>({})) as {
      name?: string;
      target_reference?: string;
      target_type?: string;
      scope?: string;
      authorization_confirmed?: boolean;
    };
    const name = (body.name || "").trim().slice(0,120);
    const targetType = (body.target_type || "other").trim();
    const scope = (body.scope || "").trim().slice(0,2000);
    if (!name || !scope) return json({error:"name and scope are required"}, 400);
    if (!reaTargetTypes.has(targetType)) return json({error:"unsupported target type"}, 400);
    if (body.authorization_confirmed !== true) return json({error:"explicit authorization confirmation required"}, 400);

    const caseId = crypto.randomUUID();
    const target = sanitizeTargetReference(body.target_reference || "");
    const initialStatus = reaRuntimeAvailable(env) ? "intake" : "awaiting_runtime";
    await env.DB.prepare(`
      INSERT INTO rea_cases(
        id,name,target_reference,target_type,scope,authorization_confirmed,environment,production_write,status
      ) VALUES(?,?,?,?,?,1,'staging-only',0,?)
    `).bind(caseId, name, target, targetType, scope, initialStatus).run();
    await reaEvent(env, caseId, "created", `type=${targetType}; runtime=${reaRuntimeAvailable(env)}`);
    await audit(env, "web", "rea_case_created", caseId, `type=${targetType}`);

    if (reaRuntimeAvailable(env)) {
      try {
        const taskId = await queueReaCase(env, caseId, "web");
        return json({ok:true, caseId, taskId, status:"queued", target_reference:target}, 202);
      } catch (err) {
        return json({ok:false, caseId, status:"failed", error:String(err)}, 500);
      }
    }
    return json({ok:true, caseId, status:"awaiting_runtime", target_reference:target}, 201);
  }

  const dispatchMatch = url.pathname.match(/^\/api\/rea\/cases\/([^/]+)\/dispatch$/);
  if (dispatchMatch && req.method === "POST") {
    const caseId = dispatchMatch[1];
    if (!reaRuntimeAvailable(env)) {
      return json({error:"REA runtime disabled; enable only in staging"}, 409);
    }
    try {
      const taskId = await queueReaCase(env, caseId, "web");
      return json({ok:true, caseId, taskId, status:"queued"}, 202);
    } catch (err) {
      return json({error:String(err)}, 400);
    }
  }

  if (url.pathname === "/api/audit" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,actor,action,target,detail,created_at FROM audit_log ORDER BY id DESC LIMIT 100"
    ).all();
    return json({audit:rows.results});
  }

  return json({error:"not found"}, 404);
}

async function handleInternal(req: Request, env: Env, url: URL): Promise<Response> {
  if (bearer(req) !== env.CALLBACK_TOKEN) return json({error:"unauthorized"}, 401);

  if (url.pathname === "/internal/task-result" && req.method === "POST") {
    const body = await req.json().catch(()=>({})) as {
      taskId?: string;
      status?: string;
      result?: string;
      error?: string;
      kind?: string;
      caseId?: string;
    };
    if (!body.taskId) return json({error:"taskId required"}, 400);
    const status = body.status === "completed" ? "completed" : "failed";
    const result = (body.result||"").slice(0,100000);
    const error = (body.error||"").slice(0,10000);
    await env.DB.prepare(
      "UPDATE tasks SET status=?, result=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(status, result, error, body.taskId).run();

    if (body.kind === "rea-scout" && body.caseId) {
      await env.DB.prepare(
        "UPDATE rea_cases SET status=?,result=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND task_id=?"
      ).bind(status, result, error, body.caseId, body.taskId).run();
      await reaEvent(env, body.caseId, `task_${status}`, error || `task=${body.taskId}`);
      await audit(env, "rea-bridge", `rea_case_${status}`, body.caseId, `task=${body.taskId}`);
    } else {
      await audit(env, "bridge", `task_${status}`, body.taskId);
    }
    return json({ok:true});
  }

  if (url.pathname === "/internal/heartbeat" && req.method === "POST") {
    const body = await req.json().catch(()=>({})) as {runtimeId?: string; state?: string; detail?: string};
    const runtimeId = body.runtimeId || "agis-bridge";
    await env.DB.prepare(`
      INSERT INTO runtime_heartbeat(runtime_id,state,detail,last_seen)
      VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(runtime_id) DO UPDATE SET
        state=excluded.state, detail=excluded.detail, last_seen=CURRENT_TIMESTAMP
    `).bind(runtimeId, body.state || "online", (body.detail||"").slice(0,1000)).run();
    return json({ok:true});
  }

  return json({error:"not found"}, 404);
}

async function fetchHandler(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return json({
      ok:true,
      env:env.APP_ENV || "unknown",
      reaRuntime:reaRuntimeAvailable(env),
      time:new Date().toISOString()
    });
  }
  if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);
  if (url.pathname.startsWith("/internal/")) return handleInternal(req, env, url);

  return env.ASSETS.fetch(req);
}

async function queueHandler(batch: MessageBatch<TaskMessage>, env: Env) {
  for (const message of batch.messages) {
    const {taskId, command, source, kind = "generic", caseId} = message.body;
    try {
      if (kind === "rea-scout" && (!caseId || !reaRuntimeAvailable(env))) {
        const reason = !caseId ? "missing REA case id" : "REA runtime disabled before dispatch";
        await env.DB.prepare(
          "UPDATE tasks SET status='blocked', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(reason, taskId).run();
        if (caseId) {
          await env.DB.prepare(
            "UPDATE rea_cases SET status='awaiting_runtime',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
          ).bind(reason, caseId).run();
          await reaEvent(env, caseId, "dispatch_blocked", reason);
        }
        await audit(env, "queue", "rea_dispatch_blocked", caseId || taskId, reason);
        message.ack();
        continue;
      }

      await env.DB.prepare(
        "UPDATE tasks SET status='dispatching', updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(taskId).run();
      if (kind === "rea-scout" && caseId) {
        await env.DB.prepare(
          "UPDATE rea_cases SET status='dispatching',updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(caseId).run();
      }

      const res = await fetch(`${env.BRIDGE_URL.replace(/\/$/,"")}/dispatch`, {
        method:"POST",
        headers:{
          "content-type":"application/json",
          "authorization":`Bearer ${env.BRIDGE_TOKEN}`
        },
        body:JSON.stringify({taskId, command, source, kind, caseId})
      });

      if (!res.ok) throw new Error(`bridge returned ${res.status}`);

      await env.DB.prepare(
        "UPDATE tasks SET status='running', updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(taskId).run();
      if (kind === "rea-scout" && caseId) {
        await env.DB.prepare(
          "UPDATE rea_cases SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(caseId).run();
        await reaEvent(env, caseId, "running", `task=${taskId}`);
      }
      await audit(env, "queue", kind === "rea-scout" ? "rea_case_dispatched" : "task_dispatched", caseId || taskId);
      message.ack();
    } catch (err) {
      const error = String(err).slice(0,1000);
      await env.DB.prepare(
        "UPDATE tasks SET status='retrying', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(error, taskId).run();
      if (kind === "rea-scout" && caseId) {
        await env.DB.prepare(
          "UPDATE rea_cases SET status='retrying',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(error, caseId).run();
        await reaEvent(env, caseId, "retrying", error);
      }
      message.retry();
    }
  }
}

export default {
  fetch: fetchHandler,
  queue: queueHandler,
} satisfies ExportedHandler<Env, TaskMessage>;
