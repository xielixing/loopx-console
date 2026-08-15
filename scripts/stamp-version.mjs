import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/stamp-version.mjs <x.y.z>');
  process.exit(1);
}

const path = 'bitfun-miniapp.json';
const manifest = JSON.parse(await readFile(path, 'utf8'));
const previous = manifest.version;
manifest.version = version;
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`stamped ${path}: ${previous} -> ${version}`);
