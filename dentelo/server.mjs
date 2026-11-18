#!/usr/bin/env node
/**
 * Dr. Ahmed Dental Clinic — local / self-hosted server (zero dependencies).
 * On Vercel the same logic runs as functions in ./api and ./public is served by the CDN.
 *
 *   node server.mjs                 → http://localhost:5500
 *   PORT=8080 node server.mjs
 *   ADMIN_PASSWORD=… CLINIC_TZ=Asia/Karachi node server.mjs
 *
 * Bookings are stored in ./data/bookings.json, or in Redis when the
 * KV_REST_API_URL / KV_REST_API_TOKEN variables are set (see README).
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handle, adminPassword } from './lib/app.mjs';
import { getStore } from './lib/store.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5500;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.wasm': 'application/wasm', '.md': 'text/plain; charset=utf-8'
};
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

/** Map a path to a route in lib/app.mjs — mirrors api/ + the rewrites in vercel.json. */
function route(p) {
  if (p === '/api/config') return ['config'];
  if (p === '/api/availability') return ['availability'];
  if (p === '/api/bookings') return ['bookings'];
  if (p === '/admin' || p === '/admin/') return ['admin', {}];
  const m = /^\/admin\/api\/bookings\/([^/]+)$/.exec(p);
  if (m) return ['admin', { id: decodeURIComponent(m[1]) }];
  return null;
}

async function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath);
  let file = path.join(PUBLIC, rel);
  if (rel.includes('/.') || (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC)) return notFound(res);
  try {
    let st = await fs.stat(file);
    if (st.isDirectory()) {
      if (!rel.endsWith('/')) { res.writeHead(301, { ...BASE_HEADERS, Location: rel + '/' }); return res.end(); }
      file = path.join(file, 'index.html'); st = await fs.stat(file);
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': /^(text\/|application\/json)/.test(type) ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    (await fs.open(file)).createReadStream().pipe(res);
  } catch {
    // the 3D explorer routes by path: unknown /explorer/... page URLs open the app, which reads the path
    if (rel.startsWith('/explorer/') && !path.extname(rel)) return serveStatic(req, res, '/explorer/index.html');
    notFound(res);
  }
}
const notFound = (res) => { res.writeHead(404, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); };

async function onRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const r = route(url.pathname);
  if (!r) {
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"ok":false,"message":"Not found"}'); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    return serveStatic(req, res, url.pathname);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('x-real-ip', req.socket.remoteAddress || '?');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: 'half' });
  const response = await handle(r[0], request, r[1]);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const store = getStore();
adminPassword();
http.createServer((req, res) => onRequest(req, res).catch((e) => { console.error(e); res.writeHead(500); res.end(); })).listen(PORT, HOST, async () => {
  console.log(`Dr. Ahmed Dental Clinic → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Admin → http://localhost:${PORT}/admin  (user "admin", password ${process.env.ADMIN_PASSWORD ? 'from ADMIN_PASSWORD' : 'in data/admin-password.txt'})`);
  console.log(`${(await store.list()).length} booking(s) in ${store.kind === 'redis' ? 'Redis' : 'data/bookings.json'}`);
});
