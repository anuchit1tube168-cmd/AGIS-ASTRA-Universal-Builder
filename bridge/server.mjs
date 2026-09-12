import http from "node:http";
import {spawn} from "node:child_process";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";
const CALLBACK_TOKEN = process.env.CALLBACK_TOKEN || "";
const CALLBACK_URL = process.env.CONTROL_PLANE_CALLBACK_URL || "";
const AGIS_REPO = process.env.AGIS_REPO || process.cwd();
const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const MAX_OUTPUT = 1_000_000;
const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 1_800_000);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 2);
let active = 0;

function send(res, status, data) {
  res.writeHead(status, {"content-type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(data));
}
async function readJson(req) { let data=""; for await (const chunk of req) { data += chunk; if (data.length > 100_000) throw new Error("request too large"); } return JSON.parse(data || "{}"); }
function authorized(req) { return req.headers.authorization === `Bearer ${BRIDGE_TOKEN}` && BRIDGE_TOKEN.length >= 24; }
async function callback(payload) { if (!CALLBACK_URL || !CALLBACK_TOKEN) return; await fetch(CALLBACK_URL,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${CALLBACK_TOKEN}`},body:JSON.stringify(payload)}); }

async function runTask(taskId, command) {
  active += 1;
  const dir = await mkdtemp(path.join(os.tmpdir(), "agis-task-"));
  const prompt = path.join(dir, "prompt.txt");
  await writeFile(prompt, command, {encoding:"utf8", mode:0o600});
  let stdout="", stderr="", finished=false;
  try {
    const child = spawn(HERMES_BIN,["chat","--oneshot","--safe-mode","--query-file",prompt],{cwd:AGIS_REPO,env:{...process.env},stdio:["ignore","pipe","pipe"]});
    const timer = setTimeout(()=>{ if (!finished) child.kill("SIGTERM"); }, TIMEOUT_MS);
    child.stdout.on("data",d=>{ if(stdout.length<MAX_OUTPUT) stdout += d.toString().slice(0,MAX_OUTPUT-stdout.length); });
    child.stderr.on("data",d=>{ if(stderr.length<MAX_OUTPUT) stderr += d.toString().slice(0,MAX_OUTPUT-stderr.length); });
    const code = await new Promise(resolve=>child.on("close",resolve));
    finished=true; clearTimeout(timer);
    if(code===0) await callback({taskId,status:"completed",result:stdout.trim()});
    else await callback({taskId,status:"failed",result:stdout.trim(),error:stderr.trim()||`exit ${code}`});
  } catch(err) { await callback({taskId,status:"failed",error:String(err)}); }
  finally { active -= 1; await rm(dir,{recursive:true,force:true}); }
}

async function heartbeat() {
  if (!CALLBACK_URL || !CALLBACK_TOKEN) return;
  const url = new URL(CALLBACK_URL); url.pathname = "/internal/heartbeat";
  try { await fetch(url,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${CALLBACK_TOKEN}`},body:JSON.stringify({runtimeId:"agis-hermes-bridge",state:"online",detail:`active=${active}; max=${MAX_CONCURRENCY}`})}); } catch {}
}

const server=http.createServer(async(req,res)=>{
  if(req.url==="/health") return send(res,200,{ok:true,active,maxConcurrency:MAX_CONCURRENCY});
  if(req.url!=="/dispatch"||req.method!=="POST") return send(res,404,{error:"not found"});
  if(!authorized(req)) return send(res,401,{error:"unauthorized"});
  if(active>=MAX_CONCURRENCY) return send(res,429,{error:"busy"});
  try { const body=await readJson(req); const taskId=String(body.taskId||""); const command=String(body.command||"").trim(); if(!taskId||!command||command.length>20000) return send(res,400,{error:"invalid task"}); void runTask(taskId,command); return send(res,202,{accepted:true,taskId}); }
  catch(err){ return send(res,400,{error:String(err)}); }
});
server.listen(PORT,HOST,()=>console.log(`AGIS bridge listening on http://${HOST}:${PORT}`));
setInterval(heartbeat,60000).unref(); void heartbeat();
