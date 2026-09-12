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
}

interface TaskMessage {
  taskId: string;
  command: string;
  source: string;
}

const enc = new TextEncoder();

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

async function protectedApi(req: Request, env: Env) {
  if (!(await validSession(req, env))) return json({error:"unauthorized"}, 401);
  return null;
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await req.json<{password?:string}>().catch(()=>({}));
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
    return json({tasks:tasks.results, heartbeat:heartbeat.results, agents:agents.results});
  }

  if (url.pathname === "/api/tasks" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,command,source,status,result,error,created_at,updated_at FROM tasks ORDER BY created_at DESC LIMIT 100"
    ).all();
    return json({tasks:rows.results});
  }

  if (url.pathname === "/api/tasks" && req.method === "POST") {
    const body = await req.json<{command?:string}>().catch(()=>({}));
    const command = (body.command || "").trim();
    if (!command || command.length > 20000) return json({error:"invalid command"}, 400);
    const taskId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO tasks(id,command,source,status) VALUES(?,?,?,'queued')"
    ).bind(taskId, command, "web").run();
    await env.TASK_QUEUE.send({taskId, command, source:"web"});
    await audit(env, "web", "task_queued", taskId, command);
    return json({ok:true, taskId}, 202);
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
    const body = await req.json<{taskId?:string,status?:string,result?:string,error?:string}>().catch(()=>({}));
    if (!body.taskId) return json({error:"taskId required"}, 400);
    const status = body.status === "completed" ? "completed" : "failed";
    await env.DB.prepare(
      "UPDATE tasks SET status=?, result=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(status, (body.result||"").slice(0,100000), (body.error||"").slice(0,10000), body.taskId).run();
    await audit(env, "bridge", `task_${status}`, body.taskId);
    return json({ok:true});
  }

  if (url.pathname === "/internal/heartbeat" && req.method === "POST") {
    const body = await req.json<{runtimeId?:string,state?:string,detail?:string}>().catch(()=>({}));
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
    return json({ok:true, env:env.APP_ENV || "unknown", time:new Date().toISOString()});
  }
  if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);
  if (url.pathname.startsWith("/internal/")) return handleInternal(req, env, url);
  return env.ASSETS.fetch(req);
}

async function queueHandler(batch: MessageBatch<TaskMessage>, env: Env) {
  for (const message of batch.messages) {
    const {taskId, command, source} = message.body;
    try {
      await env.DB.prepare(
        "UPDATE tasks SET status='dispatching', updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(taskId).run();

      const res = await fetch(`${env.BRIDGE_URL.replace(/\/$/,"")}/dispatch`, {
        method:"POST",
        headers:{
          "content-type":"application/json",
          "authorization":`Bearer ${env.BRIDGE_TOKEN}`
        },
        body:JSON.stringify({taskId, command, source})
      });
      if (!res.ok) throw new Error(`bridge returned ${res.status}`);

      await env.DB.prepare(
        "UPDATE tasks SET status='running', updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(taskId).run();
      await audit(env, "queue", "task_dispatched", taskId);
      message.ack();
    } catch (err) {
      await env.DB.prepare(
        "UPDATE tasks SET status='retrying', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(String(err).slice(0,1000), taskId).run();
      message.retry();
    }
  }
}

export default {
  fetch: fetchHandler,
  queue: queueHandler,
} satisfies ExportedHandler<Env, TaskMessage>;
