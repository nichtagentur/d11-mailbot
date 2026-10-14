const TYPES = ['start', 'poll', 'mail_in', 'ignored', 'step', 'reply_sent', 'error', 'notify'];
const HEAD = {
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...HEAD, 'content-type': 'application/json' } });
const text = (t, status) => new Response(t, { status, headers: { ...HEAD, 'content-type': 'text/plain; charset=utf-8' } });

function eqSafe(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!b) return false;
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const authed = (req, env) => eqSafe((req.headers.get('authorization') || '').replace(/^Bearer /, ''), env.PUSH_SECRET);
const viewOk = (url, env) => eqSafe(url.searchParams.get('k'), env.VIEW_KEY);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    // Bot-Zustand fuer den Cloud-Lauf (GitHub Actions): nur mit Schreib-Secret
    if (p === '/api/botstate') {
      if (!authed(req, env)) return text('forbidden', 403);
      if (req.method === 'GET') return new Response((await env.EVENTS.get('botstate')) || '{}', { headers: { ...HEAD, 'content-type': 'application/json' } });
      if (req.method === 'POST') {
        const raw = await req.text();
        if (raw.length > 200000) return text('too large', 413);
        try { JSON.parse(raw); } catch { return text('bad json', 400); }
        await env.EVENTS.put('botstate', raw);
        return json({ ok: true });
      }
    }

    if (req.method === 'POST' && (p === '/api/push' || p === '/api/state')) {
      if (!authed(req, env)) return text('forbidden', 403);
      const raw = await req.text();
      if (raw.length > 4096) return text('too large', 413);
      let body;
      try { body = JSON.parse(raw); } catch { return text('bad json', 400); }
      if (p === '/api/state') {
        await env.EVENTS.put('state', JSON.stringify(body));
        return json({ ok: true });
      }
      const ev = body && body.event;
      if (!ev || typeof ev !== 'object' || !TYPES.includes(ev.type)) return text('bad event', 400);
      let list = [];
      try { list = JSON.parse((await env.EVENTS.get('events')) || '[]'); } catch {}
      list.push(ev);
      list = list.slice(-100);
      await env.EVENTS.put('events', JSON.stringify(list));
      return json({ ok: true, n: list.length });
    }

    if (req.method === 'GET' && (p === '/api/events' || p === '/api/state')) {
      if (!viewOk(url, env)) return text('forbidden', 403);
      const key = p === '/api/events' ? 'events' : 'state';
      const v = (await env.EVENTS.get(key)) || (key === 'events' ? '[]' : '{}');
      return new Response(v, { headers: { ...HEAD, 'content-type': 'application/json' } });
    }

    if (req.method === 'GET' && p === '/') {
      if (!viewOk(url, env)) return text('403 - privater Link erforderlich', 403);
      const r = await env.ASSETS.fetch(new Request(new URL('/dashboard.html', url), { headers: {} }));
      return new Response(r.body, { status: r.status, headers: { ...HEAD, 'content-type': 'text/html; charset=utf-8' } });
    }
    return text('not found', 404);
  },
};
