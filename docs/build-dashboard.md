# Dashboard build (Agent B)

- events.mjs: startDashboard({port,getState}), emit(type,data). Routes /, /events (SSE, last 200), /state, /out/<file> (regex-guarded).
- notify-send via execFile; DBUS address + DISPLAY read from the xfce4-notifyd process environ (cached, re-read on failure).
- Public push: config from env or ~/.config/d11-mailbot.env (MAILBOT_PUSH_URL, MAILBOT_PUSH_SECRET). Addresses masked (r***@domain), text/subject/reply cut to 120, image as file name only. State pushed every 60 s and 0.5 s after each event.
- public/dashboard.html: single file. With ?k= it polls /api/events and /api/state every 5 s and hides images/preview.
- worker/: Worker d11-mailbot, KV EVENTS (d11-mailbot-events), assets ../public (run_worker_first, html_handling none). Secrets PUSH_SECRET, VIEW_KEY (values in ~/.config/d11-mailbot.env, mode 600).
- Public URL: https://d11-mailbot.nichtagentur.workers.dev/?k=<MAILBOT_VIEW_KEY>
- Test: node test/emit-demo.mjs (port 4411, 10 s). Verified: push 200, masked events with k, 403 without k, X-Robots-Tag noindex, CSP, no-store.
- Redeploy: cd worker && source ~/.env && npx -y wrangler@4 deploy
