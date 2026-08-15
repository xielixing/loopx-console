import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

// CI sanity check that mirrors the BitFun-side package validation:
// manifest shape, required files, sha256 self-consistency, and the
// runtime/user-data packaging bans. Not a substitute for the Rust
// validator, but it catches packaging mistakes before a release.

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/verify-package.mjs <package.bitfun-miniapp>');
  process.exit(1);
}

const REQUIRED_FILES = [
  'meta.json',
  'package.json',
  'source/index.html',
  'source/style.css',
  'source/ui.js',
  'source/worker.js',
  'source/esm_dependencies.json',
];
const FORBIDDEN_FILES = ['storage.json', 'compiled.html'];
const FORBIDDEN_PREFIXES = ['versions/', '.drafts/'];

const failures = [];
const fail = (message) => failures.push(message);

const zip = await JSZip.loadAsync(await readFile(file));
const manifestBytes = zip.file('bitfun-miniapp.json');
if (!manifestBytes) {
  fail('missing bitfun-miniapp.json');
  process.exitCode = 1;
  console.error('VERIFY FAIL:\n- missing bitfun-miniapp.json');
  process.exit(1);
}
const manifest = JSON.parse(await manifestBytes.async('string'));

if (manifest.schema_version !== 1) fail(`unsupported schema_version: ${manifest.schema_version}`);
if (!/^[A-Za-z0-9._-]{1,128}$/.test(manifest.package_id ?? '')) fail(`invalid package_id: ${manifest.package_id}`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) fail(`invalid version: ${manifest.version}`);
if (!manifest.publisher?.id || !manifest.publisher?.name) fail('publisher id/name required');

for (const name of REQUIRED_FILES) {
  if (!manifest.files?.[name]) fail(`manifest is missing required file: ${name}`);
}
for (const name of FORBIDDEN_FILES) {
  if (manifest.files?.[name]) fail(`runtime/user data must not be packaged: ${name}`);
}
for (const path of Object.keys(manifest.files ?? {})) {
  if (FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    fail(`runtime/user data must not be packaged: ${path}`);
  }
}

const archiveNames = Object.keys(zip.files).filter((name) => !name.endsWith('/'));
const declared = Object.keys(manifest.files ?? {}).sort();
const actual = archiveNames.filter((name) => name !== 'bitfun-miniapp.json').sort();
if (JSON.stringify(declared) !== JSON.stringify(actual)) {
  fail(
    `file list mismatch: declared ${declared.length} files, archive has ${actual.length}`,
  );
}

for (const [path, expected] of Object.entries(manifest.files ?? {})) {
  if (!/^sha256:[0-9a-f]{64}$/.test(expected)) {
    fail(`invalid sha256 for ${path}: ${expected}`);
    continue;
  }
  const entry = zip.file(path);
  if (!entry) {
    fail(`archive is missing declared file: ${path}`);
    continue;
  }
  const bytes = await entry.async('nodebuffer');
  const actualHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (actualHash !== expected) fail(`hash mismatch for ${path}`);
}

for (const dependency of manifest.runtime_dependencies ?? []) {
  if (!dependency?.probe?.commands?.length) {
    fail(`runtime dependency '${dependency?.id ?? '?'}' must declare probe commands`);
  }
}

if (failures.length > 0) {
  process.exitCode = 1;
  console.error(`VERIFY FAIL (${failures.length}):`);
  for (const message of failures) console.error(`- ${message}`);
} else {
  console.log(
    `VERIFY OK: ${Object.keys(manifest.files).length} files, all sha256 match, manifest valid`,
  );
}
