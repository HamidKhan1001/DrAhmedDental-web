/**
 * Booking API + admin page as Web-standard handlers: (Request, ctx) => Response.
 * Used by the Vercel functions in ../api and by the local ../server.mjs.
 *
 *   GET  /api/config
 *   GET  /api/availability?date=YYYY-MM-DD
 *   POST /api/bookings                 { type:'appointment'|'callback', … }
 *   GET  /admin                        (HTTP Basic auth, user "admin")
 *   POST /admin/api/bookings/:id       { status }
 */
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CLINIC, STATUSES, TAKEN_MSG, availability, checkDate, clinicToday, validate } from './clinic.mjs';
import { ConfigError, DATA_DIR, getStore } from './store.mjs';

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

const send = (status, body, headers = {}) => new Response(body, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
const json = (status, obj) => send(status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

async function readJson(req, limit = 10_000) {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) throw Object.assign(new Error('Expected JSON'), { status: 415 });
  const text = await req.text();
  if (text.length > limit) throw Object.assign(new Error('Too large'), { status: 413 });
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}

export function clientIp(req) {
  return (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '?';
}

/* ------------------------------------------------------------------ admin auth */

let adminPw;
export function adminPassword() {
  if (adminPw !== undefined) return adminPw;
  if (process.env.ADMIN_PASSWORD) return (adminPw = process.env.ADMIN_PASSWORD);
  if (process.env.VERCEL) return (adminPw = null); // no writable disk: must come from the environment
  const file = path.join(DATA_DIR, 'admin-password.txt');
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, crypto.randomBytes(15).toString('base64url') + '\n', { mode: 0o600 });
  return (adminPw = readFileSync(file, 'utf8').trim());
}

function authorised(req) {
  const want = adminPassword();
  if (!want) throw new ConfigError('Admin is not configured. Set the ADMIN_PASSWORD environment variable.');
  const m = /^Basic (.+)$/.exec(req.headers.get('authorization') || '');
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  const a = crypto.createHash('sha256').update(rest.join(':')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return user === 'admin' && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ routes */

const routes = {
  async config(req) {
    if (req.method !== 'GET') return send(405, 'Method not allowed');
    return json(200, { services: CLINIC.services, openDays: CLINIC.openDays, open: CLINIC.open, close: CLINIC.close, bookAheadDays: CLINIC.bookAheadDays });
  },

  async availability(req) {
    if (req.method !== 'GET') return send(405, 'Method not allowed');
    const date = new URL(req.url).searchParams.get('date') || '';
    const err = checkDate(date);
    if (err) return json(200, { date, closed: true, reason: err, slots: [] });
    return json(200, { date, closed: false, slots: availability(date, await getStore().list()) });
  },

  async bookings(req, { ip }) {
    if (req.method !== 'POST') return send(405, 'Method not allowed');
    const store = getStore();
    if (await store.rateLimited(ip)) return json(429, { ok: false, message: 'Too many requests. Please call the clinic instead.' });
    const body = await readJson(req);
    if (body.website) return json(200, { ok: true, ref: 'DA-000000' }); // honeypot: quietly drop bots
    const { errors, booking } = validate(body, await store.list());
    if (errors) return json(errors.time === TAKEN_MSG ? 409 : 422, { ok: false, errors });
    if (!(await store.add(booking))) return json(409, { ok: false, errors: { time: TAKEN_MSG } });
    console.log(`+ ${booking.type} ${booking.ref} ${booking.date || ''} ${booking.time || ''}`.trim());
    return json(201, { ok: true, ref: booking.ref, type: booking.type, date: booking.date, time: booking.time, service: booking.service });
  },

  async admin(req, { id }) {
    if (!authorised(req)) return send(401, 'Authentication required', { 'WWW-Authenticate': 'Basic realm="Clinic admin", charset="UTF-8"' });
    const adminHeaders = { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' };
    const store = getStore();
    if (!id) {
      if (req.method !== 'GET') return send(405, 'Method not allowed');
      return send(200, adminPage(await store.list()), { ...adminHeaders, 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (req.method !== 'POST') return send(405, 'Method not allowed');
    // custom header forces a CORS preflight, so other sites cannot trigger this with the browser's saved login
    if (req.headers.get('x-admin-action') !== '1') return send(403, 'Forbidden');
    if (!/^[\w-]{1,64}$/.test(id)) return send(404, 'Not found');
    const { status } = await readJson(req);
    if (!STATUSES.includes(status)) return send(422, 'Unknown status');
    const b = await store.setStatus(id, status);
    if (!b) return send(404, 'Not found');
    return json(200, { ok: true });
  }
};

/** Run a named route. ctx: { ip, id? } */
export async function handle(name, req, ctx = {}) {
  try {
    return await routes[name](req, { ip: clientIp(req), ...ctx });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return json(status, { ok: false, message: status === 500 ? 'Something went wrong. Please call the clinic.' : err.message });
  }
}

/* ------------------------------------------------------------------ admin page */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function adminPage(db) {
  const rows = [...db].sort((a, b) => (a.type === b.type ? 0 : a.type === 'callback' ? -1 : 1) || `${a.date || ''}${a.time || ''}`.localeCompare(`${b.date || ''}${b.time || ''}`) || a.createdAt.localeCompare(b.createdAt));
  const today = clinicToday();
  const upcoming = rows.filter(b => b.type === 'appointment' && b.date >= today && b.status !== 'cancelled').length;
  const callbacks = rows.filter(b => b.type === 'callback' && b.status === 'pending').length;
  const tr = rows.map(b => `
    <tr data-id="${esc(b.id)}" class="st-${esc(b.status)}${b.type === 'appointment' && b.date < today ? ' past' : ''}">
      <td class="mono">${esc(b.ref)}</td>
      <td>${b.type === 'callback' ? '<span class="tag">Call back</span>' : `<span class="mono">${esc(b.date)}</span><br><span class="mono big">${esc(b.time)}</span>`}</td>
      <td><strong>${esc(b.name || '—')}</strong><br><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>${b.email ? `<br><a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ''}</td>
      <td>${esc(b.service || '—')}${b.notes ? `<div class="notes">${esc(b.notes)}</div>` : ''}</td>
      <td><span class="status">${esc(b.status)}</span><div class="received mono">received ${esc(b.createdAt.slice(0, 16).replace('T', ' '))} UTC</div></td>
      <td class="actions">
        ${['confirmed', 'done', 'cancelled', 'pending'].filter(s => s !== b.status).map(s => `<button data-status="${s}">${s === 'pending' ? 'Reset' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
      </td>
    </tr>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bookings · Dr. Ahmed Dental Clinic</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f5f0;--panel:#faf8f4;--border:rgba(28,24,18,.16);--ink:#17150f;--muted:#58534a;--faint:#6f695d;--line:rgba(28,24,18,.12);--hover:rgba(28,24,18,.05);--accent:#2a3bd1;--danger:#a4493d;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#11100e;--panel:#1c1b18;--border:rgba(240,234,222,.14);--ink:#eeeae1;--muted:#aca597;--faint:#8f897c;--line:rgba(240,234,222,.12);--hover:rgba(240,234,222,.06);--accent:#97a2ff;--danger:#e08a7e;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 'Inter Tight',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:32px 16px 64px}
.eyebrow{font-family:'Source Serif 4',Georgia,serif;font-style:italic;color:var(--muted)}
h1{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:32px;letter-spacing:-.015em;margin:2px 0 18px}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}.stat{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 16px;min-width:150px}
.stat b{display:block;font-family:'Source Serif 4',serif;font-size:26px}.mono{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.02em}.big{font-size:15px;font-weight:500}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:auto}
table{width:100%;border-collapse:collapse;min-width:820px}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}
th{font:500 11px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--faint)}
a{color:var(--accent)}.notes{margin-top:6px;color:var(--muted);font-size:13px;max-width:280px;white-space:pre-wrap}
.tag{display:inline-block;padding:2px 8px;border-radius:6px;background:var(--hover);font:500 11px 'JetBrains Mono',monospace;text-transform:uppercase}
.status{display:inline-block;padding:2px 8px;border-radius:6px;font:500 11px 'JetBrains Mono',monospace;text-transform:uppercase;background:var(--hover)}
.st-confirmed .status{background:var(--accent);color:var(--panel)}.st-done .status{background:var(--ink);color:var(--panel)}.st-cancelled .status{color:var(--danger)}
.st-cancelled td,.past td{opacity:.55}.received{color:var(--faint);margin-top:6px;font-size:11px}
.actions{white-space:nowrap}.actions button{font:500 12px 'Inter Tight',sans-serif;color:var(--ink);background:transparent;border:1px solid var(--border);border-radius:6px;height:28px;padding:0 10px;margin:0 4px 4px 0;cursor:pointer}
.actions button:hover{background:var(--hover)}.actions button[data-status=confirmed]{background:var(--accent);border-color:var(--accent);color:var(--panel)}
.empty{padding:40px;text-align:center;color:var(--muted)}.top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.top a{font-size:13px}
</style></head><body><div class="wrap">
<div class="top"><div><div class="eyebrow">Dr. Ahmed Dental Clinic</div><h1>Bookings</h1></div><a href="/">← Back to site</a></div>
<div class="stats"><div class="stat"><span class="mono">Upcoming</span><b>${upcoming}</b></div><div class="stat"><span class="mono">Call-backs waiting</span><b>${callbacks}</b></div><div class="stat"><span class="mono">All requests</span><b>${rows.length}</b></div></div>
<div class="card">${rows.length ? `<table><thead><tr><th>Ref</th><th>When</th><th>Patient</th><th>Service · notes</th><th>Status</th><th></th></tr></thead><tbody>${tr}</tbody></table>` : '<div class="empty">No bookings yet. New requests from the website appear here.</div>'}</div>
</div>
<script>
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-status]'); if (!btn) return;
  const id = btn.closest('tr').dataset.id; btn.disabled = true;
  const r = await fetch('/admin/api/bookings/' + encodeURIComponent(id), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Action': '1' }, body: JSON.stringify({ status: btn.dataset.status }) });
  if (r.ok) location.reload(); else { btn.disabled = false; let m = await r.text(); try { m = JSON.parse(m).message || m; } catch {} alert('Could not update: ' + m); }
});
</script></body></html>`;
}
