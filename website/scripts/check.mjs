// Static checks for the website — Node standard library only.
//
//   npm run check              errors fail; missing download URLs are warnings
//   npm run check -- --strict  missing download URLs fail too (use before publishing)
//
// Checks: the download configuration (via the same rules the page uses), the
// HTML (duplicate ids, in-page links, ARIA references, icons, local files,
// image alt text, button types, no hard-coded installer links), JavaScript
// syntax, and that every CSS custom property used is defined.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const strict = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const fail = msg => errors.push(msg);
const warn = msg => warnings.push(msg);

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(d => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [full];
  });
}

// ── downloads ─────────────────────────────────────────────────────────────
const {DOWNLOADS} = await import(pathToFileURL(path.join(SRC, 'js', 'downloads.config.js')).href);
const {validateDownloads, resolveDownload} = await import(pathToFileURL(path.join(SRC, 'js', 'download-rules.js')).href);

for (const p of validateDownloads(DOWNLOADS)) {
  const msg = `downloads.${p.platform}: ${p.message}`;
  if (p.level === 'error') fail(msg);
  else if (strict) fail(`${msg} (--strict)`);
  else warn(msg);
}

// The rules themselves, on cases that must never pass.
const ruleCases = [
  ['android', {url: 'https://files.example.com/WeighingQR.apk'}, '', 'ready'],
  ['windows', {url: 'https://files.example.com/Setup.exe'}, '', 'ready'],
  ['android', {url: ''}, '', 'unconfigured'],
  ['android', {url: 'https://files.example.com/Setup.exe'}, '', 'invalid'],
  ['windows', {url: 'https://files.example.com/app.apk'}, '', 'invalid'],
  ['android', {url: 'http://files.example.com/app.apk'}, '', 'invalid'],
  ['android', {url: 'http://127.0.0.1:4173/local-downloads/android/app.apk'}, '', 'ready'],
  ['android', {url: 'https://x.example/a.apk'}, 'https://x.example/a.apk', 'invalid'],
  ['android', {url: 'not a url at all'}, '', 'invalid'],
];
for (const [platform, entry, other, expected] of ruleCases) {
  const got = resolveDownload(platform, entry, other).state;
  if (got !== expected) fail(`download rule self-test: ${platform} ${JSON.stringify(entry.url)} -> ${got}, expected ${expected}`);
}

// ── HTML ──────────────────────────────────────────────────────────────────
const htmlFile = path.join(SRC, 'index.html');
const html = fs.readFileSync(htmlFile, 'utf8');
const attrs = name => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(m => m[1]);

const ids = attrs('id');
const idSet = new Set(ids);
const seen = new Set();
for (const id of ids) {
  if (seen.has(id)) fail(`index.html: duplicate id "${id}"`);
  seen.add(id);
}

for (const href of attrs('href')) {
  if (href.startsWith('#')) {
    if (href.length > 1 && !idSet.has(href.slice(1))) fail(`index.html: link to missing id ${href}`);
  } else if (/^(https?:|mailto:|tel:)/.test(href)) {
    if (/\.(apk|exe)(\?|#|$)/i.test(href)) fail(`index.html: installer URL hard-coded in HTML (${href}) — use downloads.config.js`);
  } else if (!fs.existsSync(path.join(SRC, href))) {
    fail(`index.html: local file not found: ${href}`);
  }
  if (/\.(apk|exe)(\?|#|$)/i.test(href) && !/^https?:/.test(href)) fail(`index.html: installer link hard-coded in HTML (${href})`);
}
for (const src of attrs('src')) {
  if (!/^https?:/.test(src) && !fs.existsSync(path.join(SRC, src))) fail(`index.html: local file not found: ${src}`);
}
for (const name of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for', 'data-copy-target']) {
  for (const value of attrs(name)) {
    for (const ref of value.split(/\s+/).filter(Boolean)) {
      if (!idSet.has(ref)) fail(`index.html: ${name}="${ref}" points to a missing id`);
    }
  }
}

const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
for (const m of html.matchAll(/<use href="#([^"]+)"/g)) {
  if (!symbols.has(m[1])) fail(`index.html: icon #${m[1]} is not defined`);
}
for (const m of html.matchAll(/<img\b[^>]*>/g)) {
  if (!/\salt="/.test(m[0])) fail(`index.html: <img> without alt: ${m[0].slice(0, 80)}`);
}
for (const m of html.matchAll(/<button\b[^>]*>/g)) {
  if (!/\stype="/.test(m[0])) fail(`index.html: <button> without type: ${m[0].slice(0, 80)}`);
}
for (const platform of ['android', 'windows']) {
  if (!html.includes(`data-download-card="${platform}"`)) fail(`index.html: no download card for ${platform}`);
  if (!html.includes(`data-download-link="${platform}"`)) fail(`index.html: no download link for ${platform}`);
}
const knownPlatforms = new Set(Object.keys(DOWNLOADS));
for (const value of [...attrs('data-download-link'), ...attrs('data-download-card')]) {
  if (!knownPlatforms.has(value)) fail(`index.html: unknown download platform "${value}"`);
}
for (const tag of ['<title>', 'name="description"', 'name="viewport"', 'rel="icon"', '<html lang="']) {
  if (!html.includes(tag)) fail(`index.html: missing ${tag}`);
}
if ((html.match(/<h1\b/g) || []).length !== 1) fail('index.html: there must be exactly one <h1>');

// ── JavaScript syntax ─────────────────────────────────────────────────────
const jsFiles = [...walk(path.join(SRC, 'js')), ...walk(path.join(ROOT, 'scripts'))].filter(f => /\.(m?js)$/.test(f));
for (const file of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
  if (r.status !== 0) fail(`${path.relative(ROOT, file)}: ${r.stderr.trim().split('\n').slice(0, 4).join(' ')}`);
}

// ── CSS ───────────────────────────────────────────────────────────────────
const cssFiles = walk(path.join(SRC, 'styles')).filter(f => f.endsWith('.css'));
const defined = new Set();
const used = [];
for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  if (open !== close) fail(`${path.relative(ROOT, file)}: unbalanced braces (${open} { vs ${close} })`);
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const m of css.matchAll(/var\((--[\w-]+)/g)) used.push([m[1], file]);
}
for (const [name, file] of used) {
  if (!defined.has(name)) fail(`${path.relative(ROOT, file)}: var(${name}) is never defined`);
}

// ── report ────────────────────────────────────────────────────────────────
const summary = `${jsFiles.length} JS files, ${cssFiles.length} CSS files, ${ids.length} ids, ${symbols.size} icons`;
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
if (errors.length) {
  console.log(`\nCheck FAILED: ${errors.length} error(s), ${warnings.length} warning(s). (${summary})`);
  process.exit(1);
}
console.log(`\nCheck passed with ${warnings.length} warning(s). (${summary})`);
