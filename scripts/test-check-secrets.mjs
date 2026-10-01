#!/usr/bin/env node
/*
 * Proves scripts/check-secrets.mjs catches what it claims to, and leaves the
 * real .env alone. Each case builds a throwaway git repository, plants one
 * thing, and runs the check there.
 *
 * Every fake secret is assembled at run time, so this file never contains a
 * secret-shaped string itself — otherwise the check would flag its own test.
 *
 *   node scripts/test-check-secrets.mjs
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'check-secrets.mjs');
const realEnv = readFileSync(join(here, '..', '.env'), 'utf8');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.${'s'.repeat(43)}`;
const sbSecret = ['sb', 'secret', 'Xq81VbQ0aLmP3tZr9KwY2c'].join('_');
const pemHeader = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');

/** Runs the check in a fresh repository holding `files` (path -> contents). */
function run(files, { tracked = true, mode } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-secrets-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), contents);
    }
    if (tracked) execFileSync('git', ['add', '-A'], { cwd: dir });
    const args = mode ? [script, mode] : [script];
    return spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;
function check(name, result, shouldFail) {
  const didFail = result.status !== 0;
  if (didFail === shouldFail) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}\n${result.stdout}${result.stderr}`);
  }
}

// The real file must pass, or the site could never deploy.
check('the committed .env passes as it is', run({ '.env': realEnv }), false);
check('its comments name sb_secret_ and service_role and still pass', run({ '.env': '# never put sb_secret_… or service_role here\nVITE_X=1\n' }), false);
check('an old-style public (anon) key passes', run({ '.env': `VITE_SUPABASE_ANON_KEY=${jwt('anon')}\n` }), false);
check('an empty secret-named variable passes', run({ '.env': 'VITE_VAPID_PRIVATE_KEY=\n' }), false);

// Each of these must stop the build.
check('a Supabase secret key in .env is refused', run({ '.env': `${realEnv}\nVITE_SUPABASE_KEY=${sbSecret}\n` }), true);
check('an old-style service_role key in .env is refused', run({ '.env': `${realEnv}\nVITE_SUPABASE_KEY=${jwt('service_role')}\n` }), true);
check('a secret-named VITE_ variable is refused', run({ '.env': `${realEnv}\nVITE_VAPID_PRIVATE_KEY=abc123\n` }), true);
check('a secret-named plain variable is refused', run({ '.env': `${realEnv}\nSALONI_WORKER_SECRET=abc123\n` }), true);
check('a .env.production file is checked too', run({ '.env.production': 'STRIPE_SECRET_KEY=abc123\n' }), true);
check('a secret pasted into source code is refused', run({ 'src/lib/supabase.ts': `const key = '${sbSecret}';\n` }), true);
check('a private key file is refused', run({ 'keys/push.pem': `${pemHeader}\nMIIEvQ\n` }), true);
check('a secret in the built site is refused', run({ 'dist/assets/index.js': `const k="${sbSecret}";` }, { tracked: false, mode: 'dist' }), true);
check('a clean built site passes', run({ 'dist/assets/index.js': 'const k="sb_publishable_abc";' }, { tracked: false, mode: 'dist' }), false);

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
