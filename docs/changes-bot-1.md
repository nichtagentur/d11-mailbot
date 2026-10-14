# Changes bot 1

- shot.mjs: CSS injected before screenshot (chips/composer/footer/header hidden, #chat auto height), resize event, wait for tiles, clip in page coordinates with fullPage:true. Checked with robert.eml and robert2.eml (2-leg route): map fully visible, no input field.
- Dashboard: tile "Antworten gesendet" uses repliesCount, else replies.length, else the number. getState also delivers repliesCount. usd() shows 5 decimals, e.g. $0.00020 (0,020 ct).
- events.mjs: every event carries pid; the server polls out/events.jsonl every 2 s and broadcasts foreign-pid lines to SSE clients. Selftest/dry-run never call saveState, so state.json stays the service's own.
- Reply mail footer: "Kosten dieser Antwort (inkl. Screenshot): $X" with 5 decimals.
- Public push: 'ignored' events push only reason + generic text. flush() export (waits max 5 s for pending pushes) called in --dry-run/--selftest before exit; CLI processes push themselves, the service does not re-push foreign lines. CLI never pushes an empty state.
- Security: M1 Authentication-Results must show dmarc=pass or dkim=pass (<owner-domain>) else "Absender nicht verifiziert"; missing header = allowed + step "keine Auth-Header". M2 rate limit counts attempts before askApp; processed/replies trimmed to 500. M3/M4 envelope+size fetch first, source only for owner and < 2 MB; events about other senders carry only reason + uid. Low: reply address = OWNER constant, SMTP timeouts 20 s, askApp fetch timeout 60 s, events.jsonl/state.json mode 0600, Host check (403), busy stays set until an old poll really ends.
- Tests: test/robert2.eml, robert-dmarcfail.eml, robert-dmarcpass.eml.
