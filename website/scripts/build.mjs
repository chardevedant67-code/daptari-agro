// Production build — Node standard library only.
//
//   npm run build              check, then copy src/ to dist/
//   npm run build -- --strict  also require both download URLs (use before publishing)
//
// The site needs no bundling: dist/ is src/ as-is, ready for any static host.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check.mjs'), ...process.argv.slice(2)], {stdio: 'inherit'});
if (check.status !== 0) {
  console.error('\nBuild stopped: fix the check errors above first.');
  process.exit(1);
}

// dist/ only ever holds build output, so it is replaced as a whole.
if (path.basename(DIST) !== 'dist' || path.dirname(DIST) !== ROOT) throw new Error(`Refusing to clean unexpected folder ${DIST}`);
fs.rmSync(DIST, {recursive: true, force: true});
fs.cpSync(SRC, DIST, {recursive: true});

let files = 0;
let bytes = 0;
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(d => {
  const full = path.join(dir, d.name);
  if (d.isDirectory()) walk(full);
  else {
    files += 1;
    bytes += fs.statSync(full).size;
    if (/\.(apk|exe|aab)$/i.test(d.name)) throw new Error(`An installer ended up in the build: ${full}`);
  }
});
walk(DIST);
console.log(`\nBuilt dist/: ${files} files, ${(bytes / 1024).toFixed(1)} KB. Serve it with "npm run preview" or upload it to a static host.`);
