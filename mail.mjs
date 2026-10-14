import nodemailer from 'nodemailer';

export const APP_URL = 'https://d11-wien-chat.nichtagentur.workers.dev/';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mdToHtml(text) {
  return String(text || '').split(/\r?\n/).map(line => {
    let l = esc(line.trim());
    if (!l) return '<div style="height:8px"></div>';
    l = l.replace(/\*\*(.+?)\*\*/g, '<b style="color:#00e5ff">$1</b>');
    const m = l.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (m) return `<div style="margin:2px 0 2px 12px">&bull; ${m[1]}</div>`;
    return `<div style="margin:2px 0">${l}</div>`;
  }).join('\n');
}

export function fmtCost(usd) {
  const c = (+usd || 0);
  return `$${c.toFixed(5)} (${(c * 100).toFixed(3).replace('.', ',')} ct)`;
}

export function buildReply({ orig, answer, imagePath, question, imageSrc }) {
  const to = String(process.env.MAILBOT_OWNER || '').toLowerCase().trim(); // fixed owner address (secret), never the parsed string
  if (!to) throw new Error('MAILBOT_OWNER fehlt');
  let subj = String(orig.subject || '').trim() || 'Deine Frage';
  const subject = /^re:/i.test(subj) ? subj : 'Re: ' + subj;
  const link = APP_URL + '?q=' + encodeURIComponent(question);
  const cost = fmtCost(answer.usage && answer.usage.cost_usd);
  const src = imageSrc || 'cid:shot';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#12062b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#12062b"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1c0a42;border:2px solid #ff3ea5;font-family:Verdana,Arial,sans-serif;color:#f4eaff">
<tr><td style="padding:16px 20px;background:#12062b;border-bottom:2px solid #00e5ff"><span style="font-family:'Courier New',monospace;font-size:22px;letter-spacing:2px;color:#ff3ea5;font-weight:bold">WIEN CHAT BOT</span><br><span style="font-size:12px;color:#00e5ff">Wiener Linien Auskunft per Mail</span></td></tr>
<tr><td style="padding:18px 20px;font-size:13px;color:#b9a6e0"><i>Deine Frage:</i> ${esc(question)}</td></tr>
<tr><td style="padding:4px 20px 16px;font-size:15px;line-height:1.5;color:#f4eaff">${mdToHtml(answer.reply)}</td></tr>
<tr><td align="center" style="padding:8px 20px"><img src="${esc(src)}" alt="Screenshot der Antwort" width="560" style="max-width:100%;height:auto;border:2px solid #00e5ff;display:block"></td></tr>
<tr><td align="center" style="padding:18px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ff3ea5;border-radius:4px;padding:12px 24px"><a href="${esc(link)}" style="color:#12062b;font-weight:bold;text-decoration:none;font-size:15px;font-family:'Courier New',monospace">In der App oeffnen</a></td></tr></table>
<div style="margin-top:10px;font-size:12px"><a href="${APP_URL}" style="color:#00e5ff">${APP_URL}</a></div></td></tr>
<tr><td style="padding:12px 20px;background:#12062b;border-top:2px solid #ff3ea5;font-size:12px;color:#b9a6e0">Kosten dieser Antwort (inkl. Screenshot): ${esc(cost)}<br>Automatische Antwort von d11-mailbot</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${String(answer.reply || '').replace(/\*\*/g, '')}\n\nIn der App oeffnen: ${link}\nStartseite: ${APP_URL}\n\nKosten dieser Antwort (inkl. Screenshot): ${cost}\nAutomatische Antwort von d11-mailbot\n`;
  const msg = {
    from: `"Wien Chat Bot" <${process.env.MAILBOT_USER || 'support@nichtagentur.at'}>`, to, subject, html, text,
    headers: { 'X-Mailbot': 'd11', 'Auto-Submitted': 'auto-replied' },
  };
  if (orig.messageId) { msg.inReplyTo = orig.messageId; msg.references = [...(orig.references || []), orig.messageId]; }
  if (imagePath) msg.attachments = [{ filename: 'screenshot.png', path: imagePath, cid: 'shot' }];
  return msg;
}

export async function sendMail(msg) {
  const t = nodemailer.createTransport({
    host: process.env.MAILBOT_SMTP_HOST || 'mail.easyname.eu', port: 587, secure: false, requireTLS: true,
    auth: { user: process.env.MAILBOT_USER || 'support@nichtagentur.at', pass: process.env.SMTP_PASS },
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 20000,
  });
  try { return await t.sendMail(msg); } finally { t.close(); }
}

function htmlToText(h) {
  return String(h).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function extractQuestion(parsed) {
  let body = parsed.text || (parsed.html ? htmlToText(parsed.html) : '') || '';
  const out = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*>/.test(line)) continue;
    if (/^(Am .{3,200}(schrieb|geschrieben)|On .{3,200}wrote)\b/i.test(line.trim()) || /^-{2,}\s*(Original|Ursprüngliche|Weitergeleitete)/i.test(line.trim())) break;
    if (/^(Von|From):\s.+/.test(line) && out.length) break;
    if (/^-- ?$/.test(line)) break;
    out.push(line);
  }
  body = out.join('\n').trim();
  body = body.replace(/^\s*(hallo|hi|hey|servus|guten (tag|morgen|abend)|liebe[rs]?|sehr geehrte[rs]?|hello|dear)(\s+[A-ZÄÖÜ][\wäöüß]+){0,2}\s*[,!]\s*/i, '').trim();
  body = body.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) body = body.replace(/[\s,.!-]*\b(danke( schön| sehr| im voraus)?|vielen dank|dankeschön|lg|lgr|mfg|vg|liebe grüße|lieben gruß|liebe grüsse|beste grüße|beste grüsse|viele grüße|schöne grüße|freundliche grüße|mit freundlichen grüßen|grüße|gruß|grüsse|cheers|thanks|thx|best regards|regards)\b([\s,.!]+[A-ZÄÖÜ][\wäöüß]+){0,2}[\s,.!]*$/i, '').trim();
  let subj = String(parsed.subject || '').replace(/^\s*((re|aw|fwd?|wg)\s*:\s*)+/ig, '').trim();
  if (/^(test|frage|anfrage)?$/i.test(subj)) subj = '';
  let q = [subj, body].filter(Boolean).join(' - ');
  return q.slice(0, 480);
}
