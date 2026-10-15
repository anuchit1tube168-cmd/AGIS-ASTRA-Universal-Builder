import fs from 'node:fs';

const fail = (message) => {
  console.error(`Skill candidate submit failed: ${message}`);
  process.exit(1);
};

const file = process.argv[2];
if (!file) fail('usage: npm run skills:submit-candidate -- <candidate.json>');
if (!fs.existsSync(file)) fail(`file not found: ${file}`);

const token = process.env.CALLBACK_TOKEN || '';
if (token.length < 24) fail('CALLBACK_TOKEN is missing or too short');

let base = process.env.CONTROL_PLANE_URL || process.env.CONTROL_PLANE_CALLBACK_URL || '';
if (!base) fail('CONTROL_PLANE_URL or CONTROL_PLANE_CALLBACK_URL is required');
try {
  const url = new URL(base);
  url.pathname = '/internal/skill-candidate';
  url.search = '';
  url.hash = '';
  base = url.toString();
} catch {
  fail('invalid control plane URL');
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  fail(`invalid JSON: ${err}`);
}

for (const required of ['sourceTaskId','id','name','capability','procedure','acceptance_tests','failure_modes','distribution_targets']) {
  if (payload[required] === undefined || payload[required] === null || payload[required] === '') {
    fail(`candidate missing ${required}`);
  }
}

const res = await fetch(base, {
  method:'POST',
  headers:{
    'content-type':'application/json',
    'authorization':`Bearer ${token}`
  },
  body:JSON.stringify(payload)
});
const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = {raw:text}; }
if (!res.ok) fail(`${res.status}: ${body.error || text}`);
console.log(JSON.stringify(body, null, 2));
