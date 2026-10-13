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

if (!gitmodules.includes('url = https://github.com/qufei1993/skills-hub.git')) {
  fail('.gitmodules does not point to approved Skills Hub upstream');
}

const treeLine = git(['ls-tree', 'HEAD', 'vendor/skills-hub']);
const match = treeLine.match(/^160000 commit ([0-9a-f]{40})\tvendor\/skills-hub$/);
if (!match) fail('vendor/skills-hub is not a git submodule entry');
if (match[1] !== lock.commit) fail(`gitlink ${match[1]} does not match lock ${lock.commit}`);

console.log(`Skills Hub guard passed. Pinned at ${lock.commit}. Auto-sync and production writes remain disabled.`);
