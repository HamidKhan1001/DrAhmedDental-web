/**
 * Booking storage.
 *
 *  - Redis (Upstash REST API, no dependencies) when KV_REST_API_URL / KV_REST_API_TOKEN
 *    or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set. Required on Vercel,
 *    whose filesystem is read-only and not shared between requests.
 *  - Otherwise a JSON file in ./data (local development / a single long-running server).
 *
 * Both expose the same async interface: list, add, setStatus, rateLimited.
 */
import { promises as fs, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'bookings.json');

const RATE_MAX = 8, RATE_WINDOW_S = 10 * 60; // 8 submissions per 10 minutes per IP

export class ConflictError extends Error { constructor(msg) { super(msg); this.status = 409; } }
export class ConfigError extends Error { constructor(msg) { super(msg); this.status = 503; } }

/* ------------------------------------------------------------------ Redis */

function redisStore(url, token) {
  url = url.replace(/\/$/, '');
  async function call(endpoint, body) {
    const r = await fetch(url + endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw new Error(`Redis HTTP ${r.status}: ${data?.error || 'no response'}`);
    return data;
  }
  const cmd = async (...args) => { const d = await call('', args); if (d.error) throw new Error('Redis: ' + d.error); return d.result; };
  const pipe = async (...cmds) => (await call('/pipeline', cmds)).map(d => { if (d.error) throw new Error('Redis: ' + d.error); return d.result; });

  const H = 'dentelo:bookings';
  const slotKey = (b) => `dentelo:slot:${b.date}:${b.time}`;
  const SLOT_TTL = 120 * 24 * 3600; // a slot lock outlives the booking window, then expires

  return {
    kind: 'redis',
    async list() {
      const flat = (await cmd('HGETALL', H)) || [];
      const out = [];
      for (let i = 1; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch { /* skip corrupt row */ } }
      return out;
    },
    async add(b) {
      // SET NX on the slot makes double-booking impossible even with simultaneous requests
      if (b.type === 'appointment' && (await cmd('SET', slotKey(b), b.id, 'NX', 'EX', SLOT_TTL)) !== 'OK') return false;
      await cmd('HSET', H, b.id, JSON.stringify(b));
      return true;
    },
    async setStatus(id, status) {
      const raw = await cmd('HGET', H, id);
      if (!raw) return null;
      const b = JSON.parse(raw);
      if (b.type === 'appointment' && b.status !== status) {
        if (status === 'cancelled') {
          if ((await cmd('GET', slotKey(b))) === b.id) await cmd('DEL', slotKey(b));
        } else if (b.status === 'cancelled') {
          const ok = await cmd('SET', slotKey(b), b.id, 'NX', 'EX', SLOT_TTL);
          if (ok !== 'OK' && (await cmd('GET', slotKey(b))) !== b.id) throw new ConflictError('That time has since been booked by someone else.');
        }
      }
      b.status = status; b.updatedAt = new Date().toISOString();
      await cmd('HSET', H, id, JSON.stringify(b));
      return b;
    },
    async rateLimited(ip) {
      const key = `dentelo:rl:${ip}:${Math.floor(Date.now() / 1000 / RATE_WINDOW_S)}`;
      const [n] = await pipe(['INCR', key], ['EXPIRE', key, RATE_WINDOW_S]);
      return n > RATE_MAX;
    }
  };
}

/* ------------------------------------------------------------------ JSON file */

function fileStore() {
  let db = [];
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(DB_FILE)) {
    try { db = JSON.parse(readFileSync(DB_FILE, 'utf8')); } catch { console.error('! data/bookings.json is not valid JSON; starting empty (file left untouched).'); db = []; }
  }
  let writing = Promise.resolve();
  const save = () => (writing = writing.then(async () => {
    // write to a temp file then rename so a crash never leaves half a file
    const tmp = DB_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, DB_FILE);
  }));
  const clash = (b) => db.some(x => x.id !== b.id && x.type === 'appointment' && x.status !== 'cancelled' && x.date === b.date && x.time === b.time);
  const hits = new Map();

  return {
    kind: 'file',
    async list() { return db; },
    async add(b) {
      if (b.type === 'appointment' && clash(b)) return false;
      db.push(b); await save(); return true;
    },
    async setStatus(id, status) {
      const b = db.find(x => x.id === id);
      if (!b) return null;
      if (b.type === 'appointment' && b.status === 'cancelled' && status !== 'cancelled' && clash(b)) throw new ConflictError('That time has since been booked by someone else.');
      b.status = status; b.updatedAt = new Date().toISOString();
      await save(); return b;
    },
    async rateLimited(ip) {
      const now = Date.now();
      const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_S * 1000);
      list.push(now); hits.set(ip, list);
      return list.length > RATE_MAX;
    }
  };
}

/* ------------------------------------------------------------------ pick one */

let store;
export function getStore() {
  if (store) return store;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return (store = redisStore(url, token));
  if (process.env.VERCEL) throw new ConfigError('Booking storage is not configured. Add an Upstash Redis database to this Vercel project.');
  return (store = fileStore());
}
