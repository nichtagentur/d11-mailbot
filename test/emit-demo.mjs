import { startDashboard, emit } from '../events.mjs';
const st = { status: 'running', startedAt: new Date().toISOString(), lastPoll: new Date().toISOString(), processed: 1, replies: 1, totalCostUsd: 0.0123, allowedFrom: '<owner, maskiert>' };
startDashboard({ port: 4411, getState: () => st });
const seq = [
  ['mail_in', { subject: 'Wie komme ich zum Stephansdom?', from: '<MAILBOT_OWNER>', text: 'Hallo, kontakt: <MAILBOT_OWNER>' }],
  ['step', { step: 'frage extrahiert' }],
  ['ignored', { from: 'spam@example.org', reason: 'Absender nicht erlaubt' }],
  ['reply_sent', { reply: 'Antwort an <MAILBOT_OWNER>', image: 'demo.png', cost_usd: 0.0123 }],
];
let i = 0;
const t = setInterval(() => { if (i >= seq.length) return clearInterval(t); emit(...seq[i++]); }, 500);
setTimeout(() => process.exit(0), 10000);
