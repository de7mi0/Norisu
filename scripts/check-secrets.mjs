#!/usr/bin/env node
/*
 * Refuses to build the site if a secret is about to be published.
 *
 *   node scripts/check-secrets.mjs        the committed files, before building
 *   node scripts/check-secrets.mjs dist   the finished site, after building
 *
 * `npm run build` runs both, and the deploy runs `npm run build`, so a secret
 * fails the deploy instead of going live.
 *
 * Why this exists rather than taking .env out of git: the deploy builds from
 * the committed .env (GitHub has no secrets configured), and anything in a
 * VITE_ variable is copied into the JavaScript every visitor downloads anyway.
 * Ignoring the file would break the site and protect nothing. What actually
 * goes wrong is somebody pasting a secret into it, so that is what this checks.
 *
 * What it cannot do: stop a secret reaching GitHub. By the time the deploy
 * runs, the commit is already pushed. A failure here means the key is public
 * and has to be replaced in Supabase, not just deleted from the file.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const mode = process.argv[2] === 'dist' ? 'dist' : 'source';

// A variable whose NAME says it is a secret has no business in a file that is
// committed, and none at all in a VITE_ one, which ships to the browser.
const SECRET_NAME = /SECRET|PRIVATE|SERVICE_ROLE|PASSWORD/i;

// Values that are secrets whatever they are called.
const SUPABASE_SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

const problems = [];

/** The role inside a Supabase-style JWT, or null if it is not one. */
function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function scanText(file, text) {
  if (SUPABASE_SECRET_KEY.test(text)) {
    problems.push(`${file}: contains a Supabase SECRET key (sb_secret_…).`);
  }
  if (PRIVATE_KEY_BLOCK.test(text)) {
    problems.push(`${file}: contains a private key.`);
  }
  for (const token of text.match(JWT) ?? []) {
    const role = jwtRole(token);
    // The old-style public key is a JWT with role "anon", and is fine.
    // service_role is the old name for the secret key.
    if (role && role !== 'anon') {
      problems.push(`${file}: contains a Supabase key with role "${role}" — that is a secret key.`);
    }
  }
}

function scanEnvFile(file, text) {
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) return; // blank lines and comments
    const [, name, rawValue] = match;
    const value = rawValue.replace(/^['"]|['"]$/g, '').trim();
    if (value && SECRET_NAME.test(name)) {
      const where = name.startsWith('VITE_')
        ? 'and every VITE_ value is copied into the app every visitor downloads'
        : 'and this file is committed to GitHub';
      problems.push(`${file}:${index + 1}: ${name} looks like a secret, ${where}.`);
    }
  });
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    // Not a git checkout: the .env file is the one that matters most.
    console.warn('check-secrets: not a git checkout, checking .env only.');
    return ['.env'];
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function readText(path) {
  try {
    const buffer = readFileSync(path);
    // Images, fonts and the like: a NUL byte means it is not text.
    return buffer.includes(0) ? null : buffer.toString('utf8');
  } catch {
    return null; // listed by git but deleted locally
  }
}

if (mode === 'source') {
  for (const file of trackedFiles()) {
    const text = readText(join(root, file));
    if (text === null) continue;
    scanText(file, text);
    if (/(^|\/)\.env(\.|$)/.test(file)) scanEnvFile(file, text);
  }
} else {
  const dist = join(root, 'dist');
  for (const path of walk(dist)) {
    const text = readText(path);
    if (text !== null) scanText(relative(root, path), text);
  }
}

if (problems.length > 0) {
  console.error(`\nSTOPPED: a secret would be published (${mode === 'dist' ? 'in the built site' : 'in the repository'}).\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`
What to do:
  1. Remove it from the file. Secrets belong in Supabase
     (Edge Functions -> Secrets), never in this repository.
  2. If it was already pushed to GitHub, it is public. Make a new one in
     Supabase and delete the old one — removing the line does not un-publish it.
`);
  process.exit(1);
}

console.log(`check-secrets: no secrets found (${mode}).`);
