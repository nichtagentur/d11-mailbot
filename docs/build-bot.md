# Bot core (Agent A)

Files: bot.mjs (service + CLI), ask-app.mjs (askApp: chat API + local routing), shot.mjs (Playwright screenshot), mail.mjs (buildReply, sendMail, extractQuestion), d11-mailbot.service, events-stub.mjs (fallback when events.mjs is missing).

Flow: poll IMAP every 60 s (one connection, BODY.PEEK) -> filter (From exactly <MAILBOT_OWNER>, no auto/list/bulk, no X-Mailbot, max 10 replies/h) -> extract question -> ask app -> screenshot -> HTML reply (out/reply-<uid>.html, out/shot-<uid>.png) -> SMTP. State in state.json. Secrets: SMTP_PASS from ~/.env.

Start: `cp d11-mailbot.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now d11-mailbot` (needs XDG_RUNTIME_DIR=/run/user/1000).

CLI:
- `node bot.mjs` run the service
- `node bot.mjs --dry-run test/robert.eml` full pipeline, no IMAP/SMTP, output in out/
- `node bot.mjs --selftest "<question>"` SENDS a [TEST] mail to <MAILBOT_OWNER>
- `node bot.mjs --check` IMAP login, prints INBOX count
