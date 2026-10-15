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

const SKILL_EXTRACTOR_EXECUTION_ENABLED = process.env.SKILL_EXTRACTOR_EXECUTION_ENABLED === "true";
const SKILL_HERMES_HOME = process.env.SKILL_HERMES_HOME ? path.resolve(process.env.SKILL_HERMES_HOME) : "";
const SKILL_WORKSPACE_ROOT = process.env.SKILL_WORKSPACE_ROOT ? path.resolve(process.env.SKILL_WORKSPACE_ROOT) : "";
const SKILL_MAX_CONCURRENCY = Number(process.env.SKILL_MAX_CONCURRENCY || 1);

let active = 0;
let reaActive = 0;
let skillActive = 0;

function send(res, status, data) {
  res.writeHead(status, {"content-type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(data));
}
async function readJson(req) { let data=""; for await (const chunk of req) { data += chunk; if (data.length > 100_000) throw new Error("request too large"); } return JSON.parse(data || "{}"); }
function authorized(req) { return req.headers.authorization === `Bearer ${BRIDGE_TOKEN}` && BRIDGE_TOKEN.length >= 24; }
async function callback(payload) { if (!CALLBACK_URL || !CALLBACK_TOKEN) return; await fetch(CALLBACK_URL,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${CALLBACK_TOKEN}`},body:JSON.stringify(payload)}); }

function isolatedConfigReady(enabled, home, workspace) {
  return Boolean(enabled && home && workspace && home !== workspace && workspace !== AGIS_REPO && home !== AGIS_REPO);
}
function reaConfigReady() { return isolatedConfigReady(REA_EXECUTION_ENABLED, REA_HERMES_HOME, REA_WORKSPACE_ROOT); }
function skillConfigReady() { return isolatedConfigReady(SKILL_EXTRACTOR_EXECUTION_ENABLED, SKILL_HERMES_HOME, SKILL_WORKSPACE_ROOT); }

function isolatedChildEnv(home, tempDir, userName) {
  const env = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: home,
    TMPDIR: tempDir,
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "",
    USER: userName,
    LOGNAME: userName,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
  };
  return env;
}

function reaChildEnv(tempDir) {
  const env = isolatedChildEnv(REA_HERMES_HOME, tempDir, process.env.REA_RUNTIME_USER || "agis-rea");
  for (const key of ["JAVA_HOME", "GHIDRA_INSTALL_DIR", "REA_LOG_LEVEL", "REA_ANALYSIS_PROVIDER", "REA_MCP_INPUT_SCHEMA_PROFILE"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function skillChildEnv(tempDir) {
  return isolatedChildEnv(SKILL_HERMES_HOME, tempDir, process.env.SKILL_RUNTIME_USER || "agis-skill");
}

async function assertPaths(home, workspace, label) {
  if (!home || !workspace) throw new Error(`${label} isolation is not configured`);
  await access(home);
  await access(workspace);
}

async function runTask(taskId, command, metadata = {}) {
  const kind = metadata.kind === "rea-scout" ? "rea-scout" : metadata.kind === "skill-extractor" ? "skill-extractor" : "generic";
  const caseId = metadata.caseId || "";
  active += 1;
  if (kind === "rea-scout") reaActive += 1;
  if (kind === "skill-extractor") skillActive += 1;
  const prefix = kind === "rea-scout" ? "agis-rea-" : kind === "skill-extractor" ? "agis-skill-" : "agis-task-";
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const prompt = path.join(dir, "prompt.txt");
  await writeFile(prompt, command, {encoding:"utf8", mode:0o600});
  let stdout="", stderr="", finished=false;
  try {
    let cwd = AGIS_REPO;
    let childEnv = {...process.env};
    if (kind === "rea-scout") {
      if (!reaConfigReady()) throw new Error("REA runtime isolation is not configured");
      await assertPaths(REA_HERMES_HOME, REA_WORKSPACE_ROOT, "REA runtime");
      if (!caseId || !command.startsWith(`REA_SCOUT_CASE ${caseId}\n`)) throw new Error("invalid REA case envelope");
      cwd = REA_WORKSPACE_ROOT;
      childEnv = reaChildEnv(dir);
    }
    if (kind === "skill-extractor") {
      if (!skillConfigReady()) throw new Error("Skill Extractor runtime isolation is not configured");
      await assertPaths(SKILL_HERMES_HOME, SKILL_WORKSPACE_ROOT, "Skill Extractor runtime");
      if (!command.startsWith("SKILL_EXTRACTOR_SOURCE ")) throw new Error("invalid Skill Extractor envelope");
      cwd = SKILL_WORKSPACE_ROOT;
      childEnv = skillChildEnv(dir);
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
    if (kind === "skill-extractor") skillActive -= 1;
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
      detail:`active=${active}; max=${MAX_CONCURRENCY}; rea=${reaConfigReady()?"ready":"disabled"}; reaActive=${reaActive}/${REA_MAX_CONCURRENCY}; skill=${skillConfigReady()?"ready":"disabled"}; skillActive=${skillActive}/${SKILL_MAX_CONCURRENCY}`
    })});
  } catch {}
}

const server=http.createServer(async(req,res)=>{
  if(req.url==="/health") return send(res,200,{ok:true,active,maxConcurrency:MAX_CONCURRENCY,rea:{ready:reaConfigReady(),active:reaActive,maxConcurrency:REA_MAX_CONCURRENCY},skillExtractor:{ready:skillConfigReady(),active:skillActive,maxConcurrency:SKILL_MAX_CONCURRENCY}});
  if(req.url!=="/dispatch"||req.method!=="POST") return send(res,404,{error:"not found"});
  if(!authorized(req)) return send(res,401,{error:"unauthorized"});
  if(active>=MAX_CONCURRENCY) return send(res,429,{error:"busy"});
  try {
    const body=await readJson(req);
    const taskId=String(body.taskId||"");
    const command=String(body.command||"").trim();
    const kind=body.kind === "rea-scout" ? "rea-scout" : body.kind === "skill-extractor" ? "skill-extractor" : body.kind === "generic" || !body.kind ? "generic" : "invalid";
    const caseId=String(body.caseId||"");
    if(!taskId||!command||command.length>20000||kind==="invalid") return send(res,400,{error:"invalid task"});
    if(kind==="rea-scout") {
      if(!reaConfigReady()) return send(res,503,{error:"REA runtime disabled or isolation paths not configured"});
      if(!caseId||!command.startsWith(`REA_SCOUT_CASE ${caseId}\n`)) return send(res,400,{error:"invalid REA case envelope"});
      if(reaActive>=REA_MAX_CONCURRENCY) return send(res,429,{error:"REA runtime busy"});
    }
    if(kind==="skill-extractor") {
      if(!skillConfigReady()) return send(res,503,{error:"Skill Extractor disabled or isolation paths not configured"});
      if(!command.startsWith("SKILL_EXTRACTOR_SOURCE ")) return send(res,400,{error:"invalid Skill Extractor envelope"});
      if(skillActive>=SKILL_MAX_CONCURRENCY) return send(res,429,{error:"Skill Extractor runtime busy"});
    }
    void runTask(taskId,command,{kind,caseId});
    return send(res,202,{accepted:true,taskId,kind,caseId:caseId||undefined});
  }
  catch(err){ return send(res,400,{error:String(err)}); }
});
server.listen(PORT,HOST,()=>console.log(`AGIS bridge listening on http://${HOST}:${PORT}; REA=${reaConfigReady()?"ready":"disabled"}; SKILL=${skillConfigReady()?"ready":"disabled"}`));
setInterval(heartbeat,60000).unref(); void heartbeat();
