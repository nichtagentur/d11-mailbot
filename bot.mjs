import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { askApp } from './ask-app.mjs';
import { screenshot } from './shot.mjs';
import { buildReply, sendMail, extractQuestion, APP_URL } from './mail.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out');
const STATE_FILE = path.join(DIR, 'state.json');
const SELF = 'support@nichtagentur.at';
fs.mkdirSync(OUT, { recursive: true });

// events: real module if present, else stub
let emit, startDashboard, flush = async () => {}, setStateProvider = () => {};
try { ({ emit, startDashboard, flush, setStateProvider } = await import('./events.mjs')); }
catch { ({ emit, startDashboard } = await import('./events-stub.mjs')); }

// secrets: parse files ourselves, only copy what we need, never log
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (['SMTP_PASS', 'MAILBOT_PUSH_URL', 'MAILBOT_PUSH_SECRET', 'MAILBOT_OWNER'].includes(m[1]) && !process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}
loadEnv(path.join(os.homedir(), '.env'));
loadEnv(path.join(os.homedir(), '.config/d11-mailbot.env'));
// einzige erlaubte Absenderadresse: kommt aus dem Secret MAILBOT_OWNER, steht nicht im Code
const OWNER = String(process.env.MAILBOT_OWNER || '').toLowerCase().trim();
if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(OWNER)) { console.error('MAILBOT_OWNER fehlt'); process.exit(2); }
const OWNER_DOMAIN = OWNER.split('@')[1];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let startedAt = process.env.MAILBOT_SINCE ? new Date(process.env.MAILBOT_SINCE) : new Date();
const FOLDERS = ['INBOX', 'Junk']; // easyname sortiert manche echten Mails in Junk
let state = { processed: [], replies: [], totalCostUsd: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
const saveState = () => {
  if (process.argv[2] === '--once') return; // Cloud: Zustand nur im Worker
  state.processed = state.processed.slice(-2000);
  state.replies = state.replies.slice(-500);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1), { mode: 0o600 });
  try { fs.chmodSync(STATE_FILE, 0o600); } catch {}
};
const live = { status: 'starting', lastPoll: null };
const getState = () => ({ allowedFrom: OWNER, status: live.status, startedAt, lastPoll: live.lastPoll, processed: state.processed.length, replies: state.replies.slice(-50), repliesCount: state.replies.length, totalCostUsd: state.totalCostUsd });

const msgText = e => String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300);

function imapClient() {
  return new ImapFlow({ host: 'mail.easyname.eu', port: 993, secure: true, auth: { user: SELF, pass: process.env.SMTP_PASS }, logger: false });
}

// ---- filter ----
let authMissing = false;
function filterMail(parsed) {
  const addr = String((parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || '').toLowerCase().trim();
  const h = k => { const v = parsed.headers.get(k); return v == null ? null : (typeof v === 'object' && v.text != null ? v.text : String(v)); };
  if (addr !== OWNER) return 'Absender nicht erlaubt';
  if (addr === SELF) return 'eigene Adresse';
  const auto = h('auto-submitted');
  if (auto && auto.trim().toLowerCase() !== 'no') return 'Auto-Submitted';
  if (parsed.headers.has('list-id') || parsed.headers.has('list-unsubscribe')) return 'Mailingliste';
  const prec = h('precedence');
  if (prec && /bulk|junk|list/i.test(prec)) return 'Precedence ' + prec.trim();
  const spfLine = (parsed.headerLines || []).find(l => l.key === 'received-spf');
  if (parsed.headerLines) {
    const spf = spfLine ? spfLine.line : '';
    if (!/^received-spf:\s*pass\b/i.test(spf) || !new RegExp('envelope-from=<?[^;\\s>]*@' + esc(OWNER_DOMAIN) + '\\b', 'i').test(spf)) return 'Absender nicht verifiziert';
  }
  const ar = parsed.headers.get('authentication-results');
  if (ar) {
    const t = typeof ar === 'object' && ar.text != null ? ar.text : String(ar);
    const ok = /dmarc=pass/i.test(t) || new RegExp('dkim=pass[^;]*header\\.(d|i)=[^;\\s]*' + esc(OWNER_DOMAIN), 'i').test(t) || (/dkim=pass/i.test(t) && !/header\.(d|i)=/i.test(t));
    if (!ok) return 'Absender nicht verifiziert';
  } else authMissing = true;
  if (parsed.headers.has('x-mailbot')) return 'X-Mailbot (eigene Mail)';
  return null;
}
function rateLimited() {
  const cut = Date.now() - 3600e3;
  return state.replies.filter(r => r.t > cut).length >= 10;
}

// ---- pipeline ----
async function handle(parsed, uid, { send = true, forceQuestion } = {}) {
  const from = OWNER;
  const subject = parsed.subject || '';
  authMissing = false;
  const reason = forceQuestion ? null : filterMail(parsed) || (send && rateLimited() ? 'Rate-Limit (10/Stunde)' : null);
  if (reason) {
    const addr = String((parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || '').toLowerCase().trim();
    // other senders: no subject/from anywhere (shared inbox)
    emit('ignored', addr === OWNER && reason !== 'Absender nicht verifiziert' ? { reason, subject, from, uid } : { reason, uid });
    return { ignored: reason };
  }
  if (authMissing) emit('step', { step: 'keine Auth-Header' });
  const attempt = { t: Date.now(), uid, cost_usd: 0 };
  if (send) state.replies.push(attempt); // rate limit counts attempts
  const t0 = Date.now();
  try {
    emit('mail_in', { subject, from, text: String(parsed.text || '').slice(0, 300) });
    const question = forceQuestion || extractQuestion(parsed);
    if (!question) { emit('ignored', { reason: 'leere Frage', subject, from }); return { ignored: 'leere Frage' }; }
    emit('step', { step: 'Frage extrahiert', text: question });
    const answer = await askApp(question);
    emit('step', { step: 'App gefragt', text: answer.reply.slice(0, 300), cost_usd: answer.usage.cost_usd, ms: answer.ms });
    const shotName = `shot-${uid}.png`;
    const shotPath = path.join(OUT, shotName);
    emit('step', { step: 'Screenshot' });
    await screenshot(question, shotPath);
    const orig = { from: forceQuestion ? OWNER : from, subject: forceQuestion ? `[TEST] Wien Chat Bot: ${forceQuestion}` : subject,
      messageId: parsed.messageId, references: parsed.references ? [].concat(parsed.references) : [] };
    const msg = buildReply({ orig, answer, imagePath: shotPath, question });
    const prev = buildReply({ orig, answer, question, imageSrc: shotName });
    fs.writeFileSync(path.join(OUT, `reply-${uid}.html`), prev.html);
    const link = APP_URL + '?q=' + encodeURIComponent(question);
    if (send) {
      await sendMail(msg);
      attempt.cost_usd = answer.usage.cost_usd;
      state.totalCostUsd += answer.usage.cost_usd;
    }
    emit('reply_sent', { subject: msg.subject, reply: answer.reply, image: shotName, link, cost_usd: answer.usage.cost_usd, ms: Date.now() - t0, text: send ? undefined : 'dry-run' });
    return { ok: true, question, answer };
  } catch (e) {
    emit('error', { reason: msgText(e), subject, from });
    return { error: msgText(e) };
  }
}

// ---- service ----
let busy = false;
async function pollOnce(client) {
  if (busy) return;
  busy = true;
  try {
    live.lastPoll = new Date().toISOString();
    const items = [];
    for (const folder of FOLDERS) {
      let lock;
      try { lock = await client.getMailboxLock(folder); } catch { continue; }
      try {
        const key = u => folder === 'INBOX' ? u : `${folder}:${u}`;
        const uids = (await client.search({ since: new Date(startedAt.getTime() - 86400e3) }, { uid: true })) || [];
        for (const uid of uids.filter(u => !state.processed.includes(key(u)))) {
          const env = await client.fetchOne(uid, { envelope: true, size: true, internalDate: true, uid: true }, { uid: true });
          if (!env) continue;
          if (new Date(env.internalDate) < startedAt) { state.processed.push(key(uid)); continue; } // alte Mails still uebergehen
          const id = folder === 'INBOX' ? uid : `${folder.toLowerCase()}-${uid}`;
          const fa = String((env.envelope && env.envelope.from && env.envelope.from[0] && env.envelope.from[0].address) || '').toLowerCase().trim();
          if (fa !== OWNER) { items.push({ k: key(uid), uid: id, skip: 'Absender nicht erlaubt' }); continue; }
          if (env.size > 2000000) { items.push({ k: key(uid), uid: id, skip: 'Mail zu gross' }); continue; }
          const m = await client.fetchOne(uid, { source: true }, { uid: true });
          if (m) items.push({ k: key(uid), uid: id, source: m.source, folder });
        }
      } finally { lock.release(); }
    }
    emit('poll', { text: `${items.length} neue Mail(s)` });
    for (const m of items) {
      state.processed.push(m.k); saveState(); await saveRemote();
      if (m.skip) { emit('ignored', { reason: m.skip, uid: m.uid }); continue; }
      if (m.folder !== 'INBOX') emit('step', { step: `im Ordner ${m.folder} gefunden` });
      const parsed = await simpleParser(m.source);
      await handle(parsed, m.uid);
      saveState(); await saveRemote();
    }
  } finally { busy = false; }
}

function withTimeout(p, ms, label) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); })]).finally(() => clearTimeout(t));
}

async function service() {
  startDashboard({ port: 4411, getState });
  emit('start', { text: 'd11-mailbot gestartet' });
  let backoff = 30000;
  for (;;) {
    const client = imapClient();
    let dead = false;
    client.on('error', e => { dead = true; emit('error', { reason: 'IMAP: ' + msgText(e) }); });
    client.on('close', () => { dead = true; });
    try {
      await client.connect();
      live.status = 'running'; backoff = 30000;
      // Start-UID einmal pro Bot-Lauf festhalten (auch ueber Reconnects), damit keine Mail verloren geht
      emit('step', { step: 'IMAP verbunden', text: `Ordner ${FOLDERS.join(', ')}, Mails ab ${startedAt.toISOString().slice(11, 19)} UTC` });
      while (!dead) {
        try { await withTimeout(pollOnce(client), 240000, 'Poll-Timeout'); }
        catch (e) { emit('error', { reason: 'Poll: ' + msgText(e) }); break; } // busy stays set until the old poll really ends
        for (let i = 0; i < 60 && !dead; i++) await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) { emit('error', { reason: 'IMAP: ' + msgText(e) }); }
    live.status = 'reconnecting';
    try { await client.logout(); } catch { try { client.close(); } catch {} }
    await new Promise(r => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 300000);
  }
}

// ---- Cloud-Lauf (GitHub Actions): Zustand liegt im Worker ----
const CLOUD = process.argv[2] === '--once';
async function remote(method, body) {
  const base = String(process.env.MAILBOT_PUSH_URL || '').replace(/\/$/, '');
  const r = await fetch(base + '/api/botstate', { method, headers: { authorization: `Bearer ${process.env.MAILBOT_PUSH_SECRET}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('botstate ' + method + ' HTTP ' + r.status);
  return r.json();
}
async function saveRemote() { if (CLOUD) await remote('POST', { ...state, processed: state.processed.slice(-2000), replies: state.replies.slice(-500) }); }

async function once() {
  const rs = await remote('GET');
  state = { processed: [], replies: [], totalCostUsd: 0, ...rs };
  if (!state.since) { state.since = new Date().toISOString(); await saveRemote(); }
  startedAt = new Date(state.since); // Mails vor dem ersten Cloud-Lauf werden nie beantwortet
  live.status = 'cloud'; setStateProvider(getState);
  const client = imapClient();
  client.on('error', () => {});
  await client.connect();
  try { await withTimeout(pollOnce(client), 240000, 'Poll-Timeout'); }
  catch (e) { emit('error', { reason: 'Cloud: ' + msgText(e) }); }
  finally { await saveRemote(); try { await client.logout(); } catch {} }
  await flush(8000);
}

// ---- CLI ----
const [, , mode, arg] = process.argv;
if (mode === '--dry-run') {
  const parsed = await simpleParser(fs.readFileSync(arg));
  const uid = 'dry-' + path.basename(arg, '.eml');
  const r = await handle(parsed, uid, { send: false });
  await flush();
  console.log(r.ignored ? 'IGNORED: ' + r.ignored : r.error ? 'ERROR: ' + r.error : `OK: out/reply-${uid}.html`);
  process.exit(0);
} else if (mode === '--selftest') {
  const q = process.argv.slice(3).join(' ');
  if (!q) { console.error('usage: --selftest <question>'); process.exit(1); }
  const parsed = { from: { value: [{ address: OWNER }] }, subject: `[TEST] Wien Chat Bot: ${q}`, text: q, headers: new Map() };
  const r = await handle(parsed, 'selftest-' + Date.now(), { send: true, forceQuestion: q });
  await flush();
  console.log(r.ok ? 'gesendet an ' + OWNER : 'Fehler: ' + (r.error || r.ignored));
  process.exit(r.ok ? 0 : 1);
} else if (mode === '--once') {
  await once();
  process.exit(0);
} else if (mode === '--check') {
  const c = imapClient();
  await c.connect();
  const st = await c.status('INBOX', { messages: true, uidNext: true });
  console.log(`IMAP ok, INBOX: ${st.messages} Mails, uidNext ${st.uidNext}`);
  await c.logout();
  process.exit(0);
} else {
  await service();
}
