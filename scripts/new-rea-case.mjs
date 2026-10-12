import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const name = args.find((arg) => !arg.startsWith('--'));
const authorized = args.includes('--authorized');
const targetArg = args.find((arg) => arg.startsWith('--target='));
const targetTypeArg = args.find((arg) => arg.startsWith('--type='));

if (!name) {
  console.error('Usage: npm run rea:new-case -- <case-name> --authorized [--target=<reference>] [--type=web|electron|android|dotnet|native|other]');
  process.exit(1);
}
if (!authorized) {
  console.error('Refusing to create a REA case without explicit --authorized confirmation.');
  process.exit(1);
}

const slug = name
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

if (!slug) {
  console.error('Case name does not produce a valid slug.');
  process.exit(1);
}

const target = targetArg ? targetArg.slice('--target='.length) : 'REDACTED_OR_NOT_SET';
const targetType = targetTypeArg ? targetTypeArg.slice('--type='.length) : 'other';
const allowedTypes = new Set(['web', 'electron', 'android', 'dotnet', 'native', 'other']);
if (!allowedTypes.has(targetType)) {
  console.error(`Unsupported type: ${targetType}`);
  process.exit(1);
}

const caseRoot = path.join(process.cwd(), 'rea-cases', slug);
if (fs.existsSync(caseRoot)) {
  console.error(`Case already exists: ${caseRoot}`);
  process.exit(1);
}

fs.mkdirSync(path.join(caseRoot, 'evidence'), { recursive: true });
const write = (relativePath, content) => {
  fs.writeFileSync(path.join(caseRoot, relativePath), content, { encoding: 'utf8', flag: 'wx' });
};

write('case.json', `${JSON.stringify({
  schema_version: 1,
  case_id: slug,
  status: 'intake',
  authorization_confirmed: true,
  target_reference: target,
  target_type: targetType,
  environment: 'staging-only',
  production_write: false,
  created_at: new Date().toISOString()
}, null, 2)}\n`);

write('evidence/index.md', `# Evidence — ${slug}\n\n## Scope\n- Authorized target only.\n- Record observations, hashes, timestamps, and reproducible steps.\n- Do not commit credentials, personal data, proprietary source, or private assets.\n\n## Observations\n\n| ID | Observation | Evidence | Confidence |\n|---|---|---|---|\n| E-001 | Pending | Pending | Low |\n`);

write('architecture.md', `# Architecture — ${slug}\n\n## Observed components\nPending evidence.\n\n## Data flow\nPending evidence.\n\n## Trust boundaries\nPending evidence.\n`);
write('feature-map.md', `# Feature Map — ${slug}\n\n| Feature | Observed behavior | Evidence IDs | Clean-room implementation note |\n|---|---|---|---|\n| Pending | Pending | Pending | Pending |\n`);
write('risk-register.md', `# Risk Register — ${slug}\n\n| Risk | Likelihood | Impact | Mitigation | Status |\n|---|---|---|---|---|\n| Unknown target behavior | Medium | High | Keep analysis isolated; no production credentials | Open |\n`);
write('implementation-plan.md', `# Clean-room Implementation Plan — ${slug}\n\n1. Validate evidence coverage.\n2. Define interfaces and expected behaviors without copying protected implementation.\n3. Build isolated prototype.\n4. Test against documented behavior.\n5. Run security audit.\n6. Extract reusable skill only after validation.\n`);
write('SKILL.md', `# Extracted Skill — ${slug}\n\nStatus: DRAFT — do not promote until evidence and security review pass.\n\n## Proven pattern\nPending.\n\n## Preconditions\nPending.\n\n## Procedure\nPending.\n\n## Tests\nPending.\n`);

console.log(`Created authorized REA case scaffold: rea-cases/${slug}`);
console.log('No REA analysis was executed. Production writes remain disabled.');
