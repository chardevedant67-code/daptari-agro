// Local preview server — Node standard library only.
//
//   npm run dev                         serve src/ on http://127.0.0.1:4173
//   npm run preview                     serve dist/ (after npm run build)
//   npm run dev -- --host 0.0.0.0       also reachable from a phone on the same Wi-Fi
//   npm run dev -- --android <file.apk> --windows <file.exe>
//                                       ALSO serve those local installers so the
//                                       download buttons can be tested. The files
//                                       are streamed from where they are — never
//                                       copied into the website — and this only
//                                       affects the local preview.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {dir: 'src', port: 4173, host: '127.0.0.1', android: null, windows: null};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`Unknown option: ${argv[i]}`);
    args[key] = argv[++i];
  }
  args.port = Number(args.port);
  return args;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/vnd.microsoft.portable-executable',
};

// Validates an installer passed on the command line.
function installer(platform, file, ext) {
  if (!file) return null;
  const full = path.resolve(file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`--${platform}: file not found: ${full}`);
  if (path.extname(full).toLowerCase() !== ext) throw new Error(`--${platform}: expected a ${ext} file, got ${path.basename(full)}`);
  const name = path.basename(full);
  return {full, name, size: fs.statSync(full).size, urlPath: `/local-downloads/${platform}/${encodeURIComponent(name)}`};
}

// Streams a file, honouring a single byte Range (lets a phone resume a large download).
function sendFile(req, res, full, {type, attachmentName} = {}) {
  const size = fs.statSync(full).size;
  const headers = {
    'Content-Type': type || TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (attachmentName) headers['Content-Disposition'] = `attachment; filename="${attachmentName.replace(/"/g, '')}"`;

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : size - Number(range[2]);
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start < 0 || start >= size) {
      res.writeHead(416, {'Content-Range': `bytes */${size}`});
      res.end();
      return;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(full, {start, end}).pipe(res);
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const docRoot = path.resolve(ROOT, args.dir);
  if (!fs.existsSync(path.join(docRoot, 'index.html'))) {
    throw new Error(`${docRoot} has no index.html${args.dir === 'dist' ? ' — run "npm run build" first' : ''}`);
  }
  const files = {
    android: installer('android', args.android, '.apk'),
    windows: installer('windows', args.windows, '.exe'),
  };
  if (files.android && files.windows && files.android.full === files.windows.full) {
    throw new Error('--android and --windows must be different files');
  }
  const override = {};
  for (const [platform, f] of Object.entries(files)) if (f) override[platform] = f.urlPath;

  const server = http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, {Allow: 'GET, HEAD'}).end();
        return;
      }
      const urlPath = decodeURIComponent(new URL(req.url, 'http://local').pathname);

      for (const f of Object.values(files)) {
        if (f && urlPath === decodeURIComponent(f.urlPath)) {
          sendFile(req, res, f.full, {attachmentName: f.name});
          return;
        }
      }

      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(docRoot, rel);
      if (full !== docRoot && !full.startsWith(docRoot + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}).end('Not found');
        return;
      }
      if (rel === 'index.html' && Object.keys(override).length) {
        // Local-only override of the download URLs (read by js/main.js).
        const html = fs.readFileSync(full, 'utf8').replace(
          '</head>',
          `  <script>window.__WQR_LOCAL_DOWNLOADS__ = ${JSON.stringify(override)};</script>\n</head>`,
        );
        res.writeHead(200, {'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store'});
        res.end(req.method === 'HEAD' ? undefined : html);
        return;
      }
      sendFile(req, res, full);
    } catch (err) {
      res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'}).end('Server error');
      console.error(err);
    }
  });

  server.listen(args.port, args.host, () => {
    const hosts = args.host === '0.0.0.0' ? ['127.0.0.1', ...lanAddresses()] : [args.host];
    console.log(`Serving ${path.relative(ROOT, docRoot) || '.'}/ at:`);
    for (const h of hosts) console.log(`  http://${h}:${args.port}/`);
    for (const [platform, f] of Object.entries(files)) {
      if (f) console.log(`Local ${platform} download (preview only): ${f.urlPath}  <- ${f.full} (${f.size} bytes)`);
    }
    if (!files.android && !files.windows) {
      console.log('Download buttons use src/js/downloads.config.js (empty URLs show "not available yet").');
    }
    console.log('Press Ctrl+C to stop.');
  });
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
