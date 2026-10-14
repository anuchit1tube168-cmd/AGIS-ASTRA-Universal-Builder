import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const fail = (message) => {
  console.error(`Skills Hub guard failed: ${message}`);
  process.exit(1);
};
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const lock = readJson('agents/skill-registry/SKILLS_HUB_UPSTREAM.lock.json');
const policy = readJson('agents/skill-registry/policy.json');
const registry = readJson('skills/registry.json');
const gitmodules = fs.readFileSync(path.join(root, '.gitmodules'), 'utf8');

if (lock.source !== 'https://github.com/qufei1993/skills-hub') fail('unexpected upstream source');
if (!/^[0-9a-f]{40}$/.test(lock.commit)) fail('upstream commit must be a full SHA');
if (lock.auto_sync_enabled !== false) fail('auto sync must remain disabled');
if (lock.production_write !== false) fail('production write must remain disabled');
if (lock.review_required_for_upgrade !== true) fail('upgrade review must remain enabled');

if (policy.mode !== 'staging-only') fail('policy mode must remain staging-only');
if (policy.auto_sync_enabled !== false) fail('policy auto sync must remain disabled');
if (policy.production_write !== false) fail('policy production write must remain disabled');
if (policy.credential_access !== false) fail('credential access must remain disabled');
if (policy.remote_publish !== false) fail('remote publish must remain disabled');
if (policy.sync_requires_review !== true) fail('sync review must remain required');
if (policy.upstream_upgrade_review !== 'required') fail('upstream review must remain required');

if (registry.schema_version !== 1) fail('unexpected registry schema version');
if (registry.auto_sync_enabled !== false) fail('registry auto sync must remain disabled');
if (registry.production_write !== false) fail('registry production write must remain disabled');
if (!Array.isArray(registry.states) || !Array.isArray(registry.skills)) fail('invalid registry structure');
const allowedStates = new Set(registry.states);
const requiredStates = [
  'DRAFT',
  'VALIDATED',
  'SECURITY_REVIEWED',
  'REGISTRY_APPROVED',
  'STAGING_SYNC',
  'VERIFIED',
  'PRODUCTION_APPROVED'
];
for (const state of requiredStates) if (!allowedStates.has(state)) fail(`missing registry state ${state}`);

const ids = new Set();
for (const item of registry.skills) {
  if (!item || typeof item !== 'object') fail('registry skill entry must be an object');
  if (!item.id || typeof item.id !== 'string') fail('registry skill entry requires id');
  if (ids.has(item.id)) fail(`duplicate registry skill id ${item.id}`);
  ids.add(item.id);
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(item.id)) fail(`registry skill ${item.id} has invalid id format`);
  if (!item.name || typeof item.name !== 'string') fail(`registry skill ${item.id} requires name`);
  if (!item.version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(item.version)) fail(`registry skill ${item.id} requires semver version`);
  if (!item.owner || typeof item.owner !== 'string') fail(`registry skill ${item.id} requires owner`);
  if (!item.source_path || typeof item.source_path !== 'string') fail(`registry skill ${item.id} requires source_path`);
  const sourcePath = path.join(root, item.source_path);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) fail(`registry skill ${item.id} source_path does not exist`);
  if (!allowedStates.has(item.state)) fail(`registry skill ${item.id} has invalid state`);
  if (!['PASS', 'PENDING', 'FAIL'].includes(item.test_status)) fail(`registry skill ${item.id} has invalid test_status`);
  if (!['PASS', 'PENDING', 'FAIL'].includes(item.security_status)) fail(`registry skill ${item.id} has invalid security_status`);
  if (!Array.isArray(item.distribution_targets) || item.distribution_targets.length === 0) fail(`registry skill ${item.id} requires distribution targets`);
  if (item.distribution_targets.some((target) => typeof target !== 'string' || !target.trim())) fail(`registry skill ${item.id} has invalid distribution target`);
  if (item.security_reviewed === true && item.security_status !== 'PASS') fail(`registry skill ${item.id} security flags disagree`);
  if (['SECURITY_REVIEWED','REGISTRY_APPROVED','STAGING_SYNC','VERIFIED','PRODUCTION_APPROVED'].includes(item.state) && item.security_reviewed !== true) {
    fail(`registry skill ${item.id} cannot be ${item.state} without security review`);
  }
  if (item.state === 'PRODUCTION_APPROVED' && item.production_approved !== true) {
    fail(`registry skill ${item.id} production approval flags disagree`);
  }
  if (item.production_approved === true && item.state !== 'PRODUCTION_APPROVED') {
    fail(`registry skill ${item.id} cannot set production_approved before terminal state`);
  }
}

if (!gitmodules.includes('url = https://github.com/qufei1993/skills-hub.git')) {
  fail('.gitmodules does not point to approved Skills Hub upstream');
}

const treeLine = git(['ls-tree', 'HEAD', 'vendor/skills-hub']);
const match = treeLine.match(/^160000 commit ([0-9a-f]{40})\tvendor\/skills-hub$/);
if (!match) fail('vendor/skills-hub is not a git submodule entry');
if (match[1] !== lock.commit) fail(`gitlink ${match[1]} does not match lock ${lock.commit}`);

const tracked = git(['ls-files', 'skills']).split('\n').filter(Boolean);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/
];
for (const file of tracked) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
  if (!['.md', '.txt', '.json', '.yaml', '.yml'].includes(path.extname(file).toLowerCase())) continue;
  const content = fs.readFileSync(full, 'utf8');
  if (secretPatterns.some((pattern) => pattern.test(content))) fail(`possible credential material in ${file}`);
}

console.log(`Skills Hub guard passed. Pinned at ${lock.commit}. ${registry.skills.length} registered skill(s). Auto-sync and production writes remain disabled.`);
