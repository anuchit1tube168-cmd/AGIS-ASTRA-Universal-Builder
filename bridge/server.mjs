import http from "node:http";
import {spawn} from "node:child_process";
import {access, mkdtemp, writeFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";
const CALLBACK_TOKEN = process.env.CALLBACK_TOKEN || "";
const CALLBACK_URL = process.env.CONTROL_PLANE_CALLBACK_URL || "";
const AGIS_REPO = path.resolve(process.env.AGIS_REPO || process.cwd());
const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const MAX_OUTPUT = 1_000_000;
const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 1_800_000);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 2);
const REA_EXECUTION_ENABLED = process.env.REA_EXECUTION_ENABLED === "true";
const REA_HERMES_HOME = process.env.REA_HERMES_HOME ? path.resolve(process.env.REA_HERMES_HOME) : "";
const REA_WORKSPACE_ROOT = process.env.REA_WORKSPACE_ROOT ? path.resolve(process.env.REA_WORKSPACE_ROOT) : "";
const REA_MAX_CONCURRENCY = Number(process.env.REA_MAX_CONCURRENCY || 1);
let active = 0;
let reaActive = 0;

function send(res, status, data) {
  res.writeHead(status, {"content-type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(data));
}
async function readJson(req) { let data=""; for await (const chunk of req) { data += chunk; if (data.length > 100_000) throw new Error("request too large"); } return JSON.parse(data || "{}"); }
function authorized(req) { return req.headers.authorization === `Bearer ${BRIDGE_TOKEN}` && BRIDGE_TOKEN.length >= 24; }
async function callback(payload) { if (!CALLBACK_URL || !CALLBACK_TOKEN) return; await fetch(CALLBACK_URL,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${CALLBACK_TOKEN}`},body:JSON.stringify(payload)}); }

function reaConfigReady() {
  return Boolean(
    REA_EXECUTION_ENABLED &&
    REA_HERMES_HOME &&
    REA_WORKSPACE_ROOT &&
    REA_HERMES_HOME !== REA_WORKSPACE_ROOT &&
    REA_WORKSPACE_ROOT !== AGIS_REPO
  );
}

function reaChildEnv(tempDir) {
  const env = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: REA_HERMES_HOME,
    TMPDIR: tempDir,
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "",
    USER: process.env.USER || "agis-rea",
    LOGNAME: process.env.LOGNAME || process.env.USER || "agis-rea",
    XDG_CONFIG_HOME: path.join(REA_HERMES_HOME, ".config"),
    XDG_CACHE_HOME: path.join(REA_HERMES_HOME, ".cache"),
  };
  for (const key of ["JAVA_HOME", "GHIDRA_INSTALL_DIR", "REA_LOG_LEVEL", "REA_ANALYSIS_PROVIDER", "REA_MCP_INPUT_SCHEMA_PROFILE"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function assertReaRuntimePaths() {
  if (!reaConfigReady()) throw new Error("REA runtime isolation is not configured");
  await access(REA_HERMES_HOME);
  await access(REA_WORKSPACE_ROOT);
}

async function runTask(taskId, command, metadata = {}) {
  const kind = metadata.kind === "rea-scout" ? "rea-scout" : "generic";
  const caseId = metadata.caseId || "";
  active += 1;
  if (kind === "rea-scout") reaActive += 1;
  const dir = await mkdtemp(path.join(os.tmpdir(), kind === "rea-scout" ? "agis-rea-" : "agis-task-"));
  const prompt = path.join(dir, "prompt.txt");
  await writeFile(prompt, command, {encoding:"utf8", mode:0o600});
  let stdout="", stderr="", finished=false;
  try {
    let cwd = AGIS_REPO;
    let childEnv = {...process.env};
    if (kind === "rea-scout") {
      await assertReaRuntimePaths();
      if (!caseId || !command.startsWith(`REA_SCOUT_CASE ${caseId}\n`)) throw new Error("invalid REA case envelope");
      cwd = REA_WORKSPACE_ROOT;
      childEnv = reaChildEnv(dir);
    }

    const child = spawn(HERMES_BIN,["chat","--oneshot","--safe-mode","--query-file",prompt],{cwd,env:childEnv,stdio:["ignore","pipe","pipe"]});
    const timer = setTimeout(()=>{ if (!finished) child.kill("SIGTERM"); }, TIMEOUT_MS);
    child.stdout.on("data",d=>{ if(stdout.length<MAX_OUTPUT) stdout += d.toString().slice(0,MAX_OUTPUT-stdout.length); });
    child.stderr.on("data",d=>{ if(stderr.length<MAX_OUTPUT) stderr += d.toString().slice(0,MAX_OUTPUT-stderr.length); });
    const code = await new Promise(resolve=>child.on("close",resolve));
    finished=true; clearTimeout(timer);
    if(code===0) await callback({taskId,status:"completed",result:stdout.trim(),kind,caseId});
    else await callback({taskId,status:"failed",result:stdout.trim(),error:stderr.trim()||`exit ${code}`,kind,caseId});
  } catch(err) {
    await callback({taskId,status:"failed",error:String(err),kind,caseId});
  } finally {
    active -= 1;
    if (kind === "rea-scout") reaActive -= 1;
    await rm(dir,{recursive:true,force:true});
  }
}

async function heartbeat() {
  if (!CALLBACK_URL || !CALLBACK_TOKEN) return;
  const url = new URL(CALLBACK_URL); url.pathname = "/internal/heartbeat";
  try {
    await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${CALLBACK_TOKEN}`},body:JSON.stringify({
      runtimeId:"agis-hermes-bridge",
      state:"online",
      detail:`active=${active}; max=${MAX_CONCURRENCY}; rea=${reaConfigReady()?"ready":"disabled"}; reaActive=${reaActive}/${REA_MAX_CONCURRENCY}`
    })});
  } catch {}
}

const server=http.createServer(async(req,res)=>{
  if(req.url==="/health") return send(res,200,{ok:true,active,maxConcurrency:MAX_CONCURRENCY,rea:{ready:reaConfigReady(),active:reaActive,maxConcurrency:REA_MAX_CONCURRENCY}});
  if(req.url!=="/dispatch"||req.method!=="POST") return send(res,404,{error:"not found"});
  if(!authorized(req)) return send(res,401,{error:"unauthorized"});
  if(active>=MAX_CONCURRENCY) return send(res,429,{error:"busy"});
  try {
    const body=await readJson(req);
    const taskId=String(body.taskId||"");
    const command=String(body.command||"").trim();
    const kind=body.kind === "rea-scout" ? "rea-scout" : body.kind === "generic" || !body.kind ? "generic" : "invalid";
    const caseId=String(body.caseId||"");
    if(!taskId||!command||command.length>20000||kind==="invalid") return send(res,400,{error:"invalid task"});
    if(kind==="rea-scout") {
      if(!reaConfigReady()) return send(res,503,{error:"REA runtime disabled or isolation paths not configured"});
      if(!caseId||!command.startsWith(`REA_SCOUT_CASE ${caseId}\n`)) return send(res,400,{error:"invalid REA case envelope"});
      if(reaActive>=REA_MAX_CONCURRENCY) return send(res,429,{error:"REA runtime busy"});
    }
    void runTask(taskId,command,{kind,caseId});
    return send(res,202,{accepted:true,taskId,kind,caseId:caseId||undefined});
  }
  catch(err){ return send(res,400,{error:String(err)}); }
});
server.listen(PORT,HOST,()=>console.log(`AGIS bridge listening on http://${HOST}:${PORT}; REA=${reaConfigReady()?"ready":"disabled"}`));
setInterval(heartbeat,60000).unref(); void heartbeat();
