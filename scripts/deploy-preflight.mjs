import fs from 'node:fs';

const ciMode = process.argv.includes('--ci');
const target = process.env.AGIS_DEPLOY_TARGET || '';
const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
const schema = fs.readFileSync('db/schema.sql', 'utf8');

const fail = (message) => {
  console.error(`Deploy preflight failed: ${message}`);
  process.exit(1);
};

const requireText = (text, pattern, message) => {
  if (!pattern.test(text)) fail(message);
};

requireText(wrangler, /main\s*=\s*"src\/worker-auto-extractor\.ts"/, 'wrangler main must use worker-auto-extractor.ts');
requireText(wrangler, /APP_ENV\s*=\s*"production"/, 'committed APP_ENV must remain production-safe');
requireText(wrangler, /REA_RUNTIME_ENABLED\s*=\s*"false"/, 'committed REA runtime must remain disabled');
requireText(wrangler, /SKILL_CANDIDATE_INGEST_ENABLED\s*=\s*"false"/, 'committed candidate ingest must remain disabled');
requireText(wrangler, /SKILL_EXTRACTOR_ENABLED\s*=\s*"false"/, 'committed skill extractor must remain disabled');

for (const table of ['tasks','audit_log','rea_cases','rea_events','skill_catalog','skill_events','skill_candidates','skill_sync_plans']) {
  requireText(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`), `schema is missing ${table}`);
}

const d1Match = wrangler.match(/database_id\s*=\s*"([^"]+)"/);
if (!d1Match) fail('D1 database_id is missing');
const hasPlaceholderD1 = d1Match[1] === 'REPLACE_WITH_D1_DATABASE_ID';

if (ciMode) {
  console.log(`Deploy preflight CI PASS. D1 configured=${!hasPlaceholderD1}. Runtime gates remain OFF in committed config.`);
  process.exit(0);
}

if (target !== 'staging') {
  fail('AGIS_DEPLOY_TARGET must be staging. This preflight intentionally refuses direct production deployment.');
}
if (hasPlaceholderD1) {
  fail('replace REPLACE_WITH_D1_DATABASE_ID before staging deployment');
}

console.log('Deploy preflight PASS for staging.');
console.log('Next: run db:migrate against the intended staging D1, then check, then deploy with staging runtime vars explicitly supplied.');
console.log('Do not enable REA or Skill Extractor gates in production configuration.');
