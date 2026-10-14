# Contract d11-mailbot (binding)

Files and owners:
- Agent A (bot): bot.mjs, ask-app.mjs, mail.mjs, shot.mjs, d11-mailbot.service, package.json
- Agent B (dashboard): events.mjs, public/dashboard.html, worker/ (Worker d11-mailbot + wrangler.toml)
- Agent C (app): ~/Projects/d11-wien-chat/public/app.js (?q= deep link)

## events.mjs (Agent B) - API for Agent A
```js
import { emit, startDashboard } from './events.mjs';
startDashboard({ port: 4411, getState: () => ({ status, startedAt, lastPoll, processed, replies, totalCostUsd }) });
emit(type, data)   // type: 'start'|'poll'|'mail_in'|'ignored'|'step'|'reply_sent'|'error'|'notify'
```
- emit writes to out/events.jsonl, pushes it via SSE to the local dashboard (GET /events), and POSTs it to the
  Worker (env MAILBOT_PUSH_URL + MAILBOT_PUSH_SECRET from ~/.config/d11-mailbot.env; silently skipped if missing).
- For the public push, emit masks addresses (<owner, maskiert>) and truncates text to 120 chars. Locally everything is shown in full.
- emit also triggers notify-send for mail_in, ignored, reply_sent, error.
- data fields (all optional): { subject, from, text, reason, step, reply, image (path relative to out/, served at /out/...), link, cost_usd, ms }
- Local server: GET / -> public/dashboard.html, GET /events (SSE, sends the last 200 events on connect), GET /state (JSON), GET /out/<file> (screenshots, reply HTML previews).

## Mail flow (Agent A)
mail_in -> filter (ignored with reason) -> step "frage extrahiert" -> step "App gefragt" (ask-app) -> step "Screenshot" -> reply_sent {reply, image, link, cost_usd}
