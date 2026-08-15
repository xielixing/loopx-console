import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';

const MANIFEST_NAME = 'bitfun-miniapp.json';
const REQUIRED_FILES = [
  'meta.json',
  'package.json',
  'source/index.html',
  'source/style.css',
  'source/ui.js',
  'source/worker.js',
  'source/esm_dependencies.json',
];
const FIXED_DATE = new Date('2000-01-01T00:00:00.000Z');

const sourceArg = process.argv[2];
if (!sourceArg) {
  console.error('Usage: node scripts/package-miniapp.mjs <miniapp-dir> [output-file]');
  process.exitCode = 1;
} else {
  const sourceDir = path.resolve(sourceArg);
  const descriptor = JSON.parse(await readFile(path.join(sourceDir, MANIFEST_NAME), 'utf8'));
  const files = new Map();
  const hashes = {};

  for (const relativePath of REQUIRED_FILES) {
    const bytes = await readFile(path.join(sourceDir, ...relativePath.split('/')));
    files.set(relativePath, bytes);
    hashes[relativePath] = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  }

  const manifest = {
    ...descriptor,
    files: Object.fromEntries(Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right))),
  };
  const outputPath = path.resolve(
    process.argv[3] ?? path.join('dist', 'miniapps', `${manifest.package_id}-${manifest.version}.bitfun-miniapp`),
  );
  const zip = new JSZip();
  zip.file(MANIFEST_NAME, `${JSON.stringify(manifest, null, 2)}\n`, { date: FIXED_DATE, createFolders: false });
  for (const [relativePath, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    zip.file(relativePath, bytes, { date: FIXED_DATE, createFolders: false });
  }
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, archive);
  console.log(outputPath);
}
