// events.mjs - local dashboard server, event log, desktop notifications, masked public push.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'out');
const LOG = path.join(OUT, 'events.jsonl');
const clients = new Set();
let getStateFn = null;
let stateTimer = null;
let pushStateSoon = null;

const NOTIFY = {
  mail_in: 'Mail von Robert',
  ignored: 'Mail ignoriert',
  reply_sent: 'Antwort gesendet',
  error: 'Fehler',
};


let busEnv = null;
function findBusEnv(cb) {
  execFile('pgrep', ['-x', 'xfce4-notifyd'], (err, out) => {
    const pid = !err && String(out).trim().split('\n')[0];
    if (!pid) return cb(null);
    try {
      const env = {};
      for (const kv of fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) {
        const i = kv.indexOf('=');
        if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
      }
      cb(env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS, DISPLAY: env.DISPLAY || ':0' } : null);
    } catch { cb(null); }
  });
}
function runNotify(title, text, extra, onFail) {
  try {
    execFile('notify-send', ['-a', 'd11-mailbot', '-i', 'mail-message-new', title, text],
      { env: { ...process.env, ...(extra || {}) } }, (e) => { if (e && onFail) onFail(); });
  } catch {}
}
function sendNotify(title, text) {
  const retry = () => findBusEnv((e) => { busEnv = e; if (e) runNotify(title, text, e); });
  if (busEnv) return runNotify(title, text, busEnv, retry);
  retry();
}

function readEnvFile() {
  const out = {};
  try {
    const txt = fs.readFileSync(path.join(os.homedir(), '.config', 'd11-mailbot.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}
function pushConfig() {
  const f = readEnvFile();
  const url = process.env.MAILBOT_PUSH_URL || f.MAILBOT_PUSH_URL;
  const secret = process.env.MAILBOT_PUSH_SECRET || f.MAILBOT_PUSH_SECRET;
  return url && secret ? { url: url.replace(/\/$/, ''), secret } : null;
}

const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const maskStr = (s) => String(s).replace(EMAIL_RE, '$1***@$2');
const cut = (s, n = 120) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function maskEvent(ev) {
  if (ev.type === 'ignored') return { ts: ev.ts, type: 'ignored', reason: ev.reason, text: 'Mail eines anderen Absenders' };
  const o = { ...ev };
  for (const k of ['from', 'text', 'subject', 'reply', 'reason', 'step', 'link']) {
    if (o[k] != null) o[k] = maskStr(o[k]);
  }
  for (const k of ['text', 'subject', 'reply']) if (o[k] != null) o[k] = cut(o[k]);
  if (o.image) o.image = path.basename(String(o.image));
  if (o.link) o.link = cut(o.link, 200);
  return o;
}
function maskState(st) {
  const o = {};
  for (const [k, v] of Object.entries(st || {})) o[k] = typeof v === 'string' ? maskStr(v) : v;
  return o;
}

const pending = new Set();
export async function flush(ms = 5000) {
  if (!pending.size) return;
  await Promise.race([Promise.allSettled([...pending]), new Promise(r => setTimeout(r, ms))]);
}
function post(pathname, body, secret, base) {
  try {
    const pr = fetch(base + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    pending.add(pr);
    pr.finally(() => pending.delete(pr));
  } catch {}
}
function pushState() {
  const c = pushConfig();
  if (!c || !getStateFn) return; // CLI processes have no state: never push an empty one
  let st = {};
  try { st = getStateFn() || {}; } catch {}
  post('/api/state', maskState(st), c.secret, c.url);
}

let chmodDone = false;
export function setStateProvider(fn) { getStateFn = fn; }
export function emit(type, data = {}) {
  const ev = { ts: new Date().toISOString(), pid: process.pid, type, ...data };
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify(ev) + '\n', { mode: 0o600 });
    if (!chmodDone) { chmodDone = true; fs.chmodSync(LOG, 0o600); }
  } catch {}
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) { try { res.write(line); } catch {} }

  if (NOTIFY[type]) {
    const text = String(ev.text || ev.reason || ev.subject || ev.reply || ev.step || '').slice(0, 200);
    sendNotify(NOTIFY[type], text);
  }

  const c = pushConfig();
  if (c) {
    post('/api/push', { event: maskEvent(ev) }, c.secret, c.url);
    clearTimeout(pushStateSoon);
    pushStateSoon = setTimeout(pushState, 500);
  }
  return ev;
}

function lastEvents(n = 200) {
  try {
    const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch { return []; }
}

// Events written by other processes (--selftest, --dry-run) are picked up from the log and broadcast.
let watchPos = 0, watchBuf = '';
function pollLog() {
  try {
    const size = fs.statSync(LOG).size;
    if (size < watchPos) { watchPos = 0; watchBuf = ''; }
    if (size === watchPos) return;
    const fd = fs.openSync(LOG, 'r');
    const buf = Buffer.alloc(size - watchPos);
    fs.readSync(fd, buf, 0, buf.length, watchPos);
    fs.closeSync(fd);
    watchPos = size;
    const parts = (watchBuf + buf.toString('utf8')).split('\n');
    watchBuf = parts.pop();
    for (const l of parts) {
      if (!l) continue;
      let ev; try { ev = JSON.parse(l); } catch { continue; }
      if (ev.pid === process.pid) continue; // own emits were already broadcast
      for (const res of clients) { try { res.write(`data: ${l}\n\n`); } catch {} }
    }
  } catch {}
}
function startLogWatch() {
  try { watchPos = fs.statSync(LOG).size; } catch { watchPos = 0; }
  const t = setInterval(pollLog, 2000);
  t.unref?.();
}

const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8' };

export function startDashboard({ port = 4411, getState } = {}) {
  if (getState) getStateFn = getState;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (!/^(127\.0\.0\.1|localhost):4411$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (p === '/' || p === '/index.html') {
      try {
        const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      } catch { res.writeHead(500); return res.end('dashboard.html missing'); }
    }
    if (p === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream', 'cache-control': 'no-store',
        connection: 'keep-alive', 'x-accel-buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      for (const l of lastEvents(200)) res.write(`data: ${l}\n\n`);
      clients.add(res);
      const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 20000);
      req.on('close', () => { clearInterval(hb); clients.delete(res); });
      return;
    }
    if (p === '/state') {
      let st = {};
      try { st = (getStateFn && getStateFn()) || {}; } catch (e) { st = { status: 'error', error: String(e.message) }; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(st));
    }
    if (p.startsWith('/out/')) {
      const name = p.slice(5);
      if (!/^[a-z0-9._-]+\.(png|html)$/.test(name) || name.includes('..')) { res.writeHead(404); return res.end('not found'); }
      const file = path.join(OUT, name);
      if (!file.startsWith(OUT + path.sep)) { res.writeHead(404); return res.end('not found'); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(name)], 'cache-control': 'no-store' });
        res.end(buf);
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  server.on('error', (e) => console.error('dashboard error:', e.message));
  server.listen(port, '127.0.0.1');
  startLogWatch();
  clearInterval(stateTimer);
  stateTimer = setInterval(pushState, 60000);
  stateTimer.unref?.();
  setTimeout(pushState, 1000).unref?.();
  return server;
}
