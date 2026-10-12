import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const fail = (message) => {
  console.error(`REA guard failed: ${message}`);
  process.exit(1);
};
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const lock = readJson('agents/rea-scout/REA_UPSTREAM.lock.json');
const policy = readJson('agents/rea-scout/policy.json');
const gitmodules = fs.readFileSync(path.join(root, '.gitmodules'), 'utf8');

if (lock.source !== 'https://github.com/morluto/rea') fail('unexpected upstream source');
if (!/^[0-9a-f]{40}$/.test(lock.commit)) fail('upstream commit must be a full 40-char SHA');
if (lock.production_enabled !== false) fail('REA production_enabled must remain false');
if (lock.review_required_for_upgrade !== true) fail('upstream upgrade review must stay enabled');

if (policy.mode !== 'staging-only') fail('policy mode must remain staging-only');
if (policy.authorization_required !== true) fail('authorization must be required');
if (policy.production_write !== false) fail('production writes must remain disabled');
for (const key of [
  'allow_auth_bypass',
  'allow_drm_bypass',
  'allow_anti_cheat_bypass',
  'allow_credential_access',
  'allow_personal_data_collection'
]) {
  if (policy[key] !== false) fail(`${key} must remain false`);
}
if (policy.unknown_binary_isolation !== 'required') fail('unknown binary isolation must be required');
if (policy.upstream_upgrade_review !== 'required') fail('upstream review must be required');
if (policy.clean_room_reimplementation !== true) fail('clean-room reimplementation must be required');

if (!gitmodules.includes('url = https://github.com/morluto/rea.git')) {
  fail('.gitmodules does not point to the approved REA upstream');
}

let treeLine = '';
try {
  treeLine = git(['ls-tree', 'HEAD', 'vendor/rea']);
} catch (error) {
  fail(`cannot inspect vendor/rea gitlink: ${error.message}`);
}
const match = treeLine.match(/^160000 commit ([0-9a-f]{40})\tvendor\/rea$/);
if (!match) fail('vendor/rea is not a git submodule entry');
if (match[1] !== lock.commit) fail(`gitlink ${match[1]} does not match locked commit ${lock.commit}`);

let trackedCases = [];
try {
  const output = git(['ls-files', 'rea-cases']);
  trackedCases = output ? output.split('\n').filter(Boolean) : [];
} catch (error) {
  fail(`cannot inspect tracked REA case files: ${error.message}`);
}

const forbiddenArtifact = /\.(apk|aab|ipa|exe|dll|dylib|so|bin|jar|class|wasm|zip|7z|rar|tar|gz|xz)$/i;
const forbiddenSecretFile = /(^|\/)(\.env(?:\..*)?|credentials(?:\.[^/]*)?\.json|id_rsa|id_ed25519|[^/]+\.(?:pem|key|p12|pfx))$/i;
for (const file of trackedCases) {
  if (forbiddenArtifact.test(file)) fail(`raw executable/archive artifact must not be committed: ${file}`);
  if (forbiddenSecretFile.test(file)) fail(`secret-bearing file must not be committed: ${file}`);
}

const caseFiles = trackedCases.filter((file) => file.endsWith('/case.json'));
for (const file of caseFiles) {
  const data = readJson(file);
  if (data.authorization_confirmed !== true) fail(`${file}: authorization_confirmed must be true`);
  if (data.environment !== 'staging-only') fail(`${file}: environment must be staging-only`);
  if (data.production_write !== false) fail(`${file}: production_write must remain false`);
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/
];
const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv']);
for (const file of trackedCases) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    fail(`possible credential material detected in ${file}; redact before commit`);
  }
}

console.log(`REA guard passed. Upstream pinned at ${lock.commit}. Production writes remain disabled.`);
console.log(`Validated ${caseFiles.length} REA case manifest(s) and ${trackedCases.length} tracked case file(s).`);
