
const ORIGIN = (process.env.MAILBOT_APP_URL || 'https://d11-wien-chat.nichtagentur.workers.dev').replace(/\/$/, '');
const URL_ = ORIGIN + '/api/chat';
const arr = x => Array.isArray(x) ? x : [];
const str = x => x == null ? '' : String(x);

let routingP = null;
function loadRouting() {
  if (!routingP) routingP = (async () => {
    // immer von der veroeffentlichten App laden: passt zur Live-Version, laeuft auch in der Cloud
    const get = async f => { const r = await fetch(ORIGIN + '/' + f, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(f + ' HTTP ' + r.status); return r.text(); };
    const [js, g, s] = await Promise.all([get('routing.js'), get('graph.json'), get('stops.json')]);
    const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
    return { mod, g: JSON.parse(g), s: JSON.parse(s) };
  })();
  return routingP;
}

function compactRoute(d) {
  return { ok: true, from: d.from, to: d.to, total_min: d.total_min, estimated: !!d.estimated, first_wait_min: d.first_wait_min, accessible_note: d.accessible_note,
    legs: arr(d.legs).map(l => l.mode === 'walk'
      ? { mode: 'walk', from: str(l.from && l.from.name), to: str(l.to && l.to.name), minutes: l.minutes }
      : { mode: 'ride', line: l.line, towards: l.towards, from: str(l.from && l.from.name), to: str(l.to && l.to.name),
          depart: l.depart, arrive: l.arrive, minutes: l.minutes, wait_before_min: l.wait_before_min,
          stops: l.stops_count != null ? l.stops_count : arr(l.stops).length }) };
}

async function plan(args) {
  const { mod, g, s } = await loadRouting();
  const pick = async q => {
    const r = arr(await mod.findStops(s, q));
    if (r[0] && r[0].outside) return { outside: true, name: str(r[0].name) };
    return { best: r[0] && (r[0].stop || r[0]), names: r.slice(0, 4).map(x => (x.stop || x).name) };
  };
  const a = await pick(args.from), b = await pick(args.to);
  const out = a.outside ? a : b.outside ? b : null;
  if (out) return { compact: { ok: false, outside: true, error: 'Ausserhalb des Wiener Linien Netzes', query: out.name }, viz: null };
  if (!a.best || !b.best) {
    const q = !a.best ? args.from : args.to;
    return { compact: { ok: false, error: 'Station nicht gefunden', query: str(q), candidates: (!a.best ? a : b).names }, viz: null };
  }
  const route = await mod.planRoute(g, s, a.best.id, b.best.id, { time: args.time || undefined, accessible: !!args.accessible });
  const data = route && route.data ? route.data : route;
  if (!data || data.ok === false || data.error || !arr(data.legs).length)
    return { compact: { ok: false, error: str(data && data.error) || 'Keine Verbindung zu dieser Zeit gefunden', query: '', candidates: [] }, viz: null };
  return { compact: compactRoute(data), viz: { type: 'route', data } };
}

async function post(body) {
  for (let t = 0; t < 3; t++) {
    const res = await fetch(URL_, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    let data = null; try { data = await res.json(); } catch {}
    if (res.status === 429 || res.status >= 502) { await new Promise(r => setTimeout(r, 8000 * (t + 1))); continue; }
    if (!res.ok) throw new Error('App HTTP ' + res.status + (data && data.error ? ': ' + str(data.error).slice(0, 100) : ''));
    return data || {};
  }
  throw new Error('App nicht erreichbar (429/5xx)');
}

export async function askApp(question) {
  const t0 = Date.now();
  const messages = [{ role: 'user', content: String(question).slice(0, 500) }];
  const usage = { calls: 0, cost_usd: 0, tokens: 0 };
  const add = u => { if (!u) return; usage.calls += 1; usage.cost_usd += +u.cost_usd || 0; usage.tokens += (+u.tokens) || ((+u.prompt_tokens || 0) + (+u.completion_tokens || 0)) || (+u.total_tokens || 0); };
  const viz = [];
  let res = await post({ messages });
  add(res.usage);
  for (let i = 0; i < 4 && res.tool_request; i++) {
    viz.push(...arr(res.viz));
    const tr = res.tool_request;
    let out;
    try { out = await plan(tr.args || {}); }
    catch (e) { out = { compact: { ok: false, error: 'Routenplanung nicht verfügbar', query: '', candidates: [] }, viz: null }; }
    if (out.viz) viz.push(out.viz);
    res = await post({ messages, pending: res.pending, tool_result: { id: tr.id, content: out.compact } });
    add(res.usage);
  }
  if (res.tool_request) throw new Error('Zu viele Tool-Schleifen');
  viz.push(...arr(res.viz));
  return { reply: typeof res.reply === 'string' ? res.reply : '', viz, usage, lang: res.lang || 'de', ms: Date.now() - t0 };
}
