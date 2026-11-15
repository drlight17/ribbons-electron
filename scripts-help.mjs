#!/usr/bin/env node
/**
 * Print npm run suggestions from package.json, filtered by current platform.
 * Usage: node scripts-help.mjs
 *        npm run help
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// package.json next to this file or in cwd
const candidates = [
  path.join(process.cwd(), 'package.json'),
  path.join(__dirname, 'package.json'),
  path.join(__dirname, '..', 'package.json')
];
const pkgPath = candidates.find((p) => fs.existsSync(p));
if (!pkgPath) {
  console.error('package.json not found');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const scripts = pkg.scripts || {};
const platform = process.platform; // win32 | linux | darwin
const arch = process.arch;

const PLATFORM_TAGS = {
  win32: ['win', 'exe', 'msi', 'zip'],
  linux: ['linux', 'rpm', 'deb', 'targz', 'appimage'],
  darwin: ['mac', 'dmg', 'zip-mac']
};

const ALWAYS = new Set(['start', 'help', 'block', 'unblock']);

/** Classify a script name for a target platform family */
function scriptPlatform(name) {
  const n = name.toLowerCase();
  if (ALWAYS.has(n)) return 'any';
  if (n === 'build-win' || /^(build-)?(exe|msi)$/.test(n) || n === 'build-zip') return 'win32';
  if (n === 'build-linux' || /rpm|deb|targz|appimage/.test(n)) return 'linux';
  if (n === 'build-mac' || /dmg|zip-mac/.test(n)) return 'darwin';
  if (n.startsWith('build-')) return 'build';
  return 'other';
}

function isRecommended(name) {
  const kind = scriptPlatform(name);
  if (kind === 'any' || kind === 'other') return true;
  if (kind === platform) return true;
  if (kind === 'build' && name === `build-${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'}`) {
    return true;
  }
  return false;
}

const names = Object.keys(scripts).sort();
const recommended = names.filter(isRecommended);
const others = names.filter((n) => !isRecommended(n));

const osLabel =
  platform === 'win32' ? 'Windows' :
  platform === 'darwin' ? 'macOS' : 'Linux';

console.log('');
console.log(`Ribbons Electron — npm scripts  (${osLabel} / ${arch})`);
console.log('─'.repeat(52));
console.log('');
console.log('Recommended on this machine:');
console.log('');
for (const name of recommended) {
  const pad = name.length >= 18 ? ' ' : ' '.repeat(18 - name.length);
  console.log(`  npm run ${name}${pad}# ${scripts[name].slice(0, 60)}${scripts[name].length > 60 ? '…' : ''}`);
}

if (others.length) {
  console.log('');
  console.log('Other targets (need matching OS or CI — native modules cannot cross-compile):');
  console.log('');
  for (const name of others) {
    const pad = name.length >= 18 ? ' ' : ' '.repeat(18 - name.length);
    console.log(`  npm run ${name}${pad}# ${scripts[name].slice(0, 60)}${scripts[name].length > 60 ? '…' : ''}`);
  }
}

console.log('');
console.log('Tip: build Windows packages on Windows, Linux on Linux, macOS on macOS.');
console.log('');
