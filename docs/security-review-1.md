# Security review 1 - d11-mailbot (read only review, 2026-10-14)

Score: 7/10. Solid basics (strict address compare, HTML escaping everywhere, 127.0.0.1 binding, masked public push, 600 env file). Main gaps: no authentication of the sender beyond the From header, bot reads and publishes subjects of OTHER people's mails from the shared inbox, no size limits, rate limit counts only successful replies.

## Allowlist (bot.mjs:52-64)
Verified by reading code (and test/spoof.eml):
- Display name spoof `"<MAILBOT_OWNER>" <evil@x>`: SAFE. Only `from.value[0].address` is compared (bot.mjs:53), the display name is ignored.
- Multiple From addresses: SAFE-ish. Only value[0] is checked. `From: evil, robert` is rejected, `From: robert, evil` is accepted but the reply goes only to robert. Fine.
- Case: SAFE, address is lowercased and trimmed (bot.mjs:53). The reply `to` keeps the original case (bot.mjs:72, 88) - harmless, but see fix L1.
- Sender header / Reply-To: SAFE, never read. Reply `to` = From address (mail.mjs:218, 237); Reply-To is ignored.
- Encoded-word headers / comments in From: mailparser decodes and strips them; the address is taken from the parsed result. SAFE.
- Group syntax (`undisclosed: robert@...;`): mailparser flattens groups into value; in value[0] there is no group wrapper, but check with a test mail (see L1).

### M1 (medium) No sender authentication (SPF/DKIM/DMARC)
bot.mjs:52-55 trusts the From header only. The Authentication-Results header is never evaluated. DNS check: <owner-domain> has DMARC `p=reject; adkim=s; aspf=s` and SPF `~all` (Google), so a spoofed mail should be rejected or flagged by any receiver that enforces DMARC. Whether mail.easyname.eu enforces it and writes Authentication-Results is NOT verified here (the fetch/headers of a real mail from Robert would show it).
Harm of a spoofer: the reply goes to Robert, not to the attacker. Possible harm = costs (app call + Playwright, max 10 replies/h by rate limit, ~cents), spam to Robert, and Robert receiving an answer to a question he did not ask (reply text can contain attacker steered text, see section 3). No data leak.
Fix (pragmatic): in filterMail (bot.mjs:55) add
```js
const ar = parsed.headers.get('authentication-results');
const arText = ar ? (ar.text || String(ar)) : '';
if (arText && !/dmarc=pass|dkim=pass/i.test(arText)) return 'Auth-Results nicht pass';
```
Strict variant: require `dkim=pass header.d=<owner-domain>` (or `dmarc=pass`) once a real test mail shows that easyname writes the header. Cheap alternative: require a shared token word in the subject (e.g. `[d11]`, already the convention for the shared inbox) so random spoofs are dropped.

## Loops and spam
- Loops: SAFE. Own address blocked (the allowlist implies it, bot.mjs:56 is dead code but harmless), Auto-Submitted, List-Id/Unsubscribe, Precedence, X-Mailbot are filtered (bot.mjs:57-62); bot reply carries `Auto-Submitted: auto-replied` and `X-Mailbot` (mail.mjs:238). Bounces come from MAILER-DAEMON, not on the allowlist.
- Restart: SAFE. startUid is uidNext at process start, held across reconnects (bot.mjs:155), mails older than startedAt are skipped (bot.mjs:128), uids are written to state.json BEFORE processing (bot.mjs:127). Old mails are not answered again. Trade-off: mails that arrive while the bot is down are never answered, and a crash mid-processing loses that mail (at-most-once). Acceptable.

### M2 (medium) Rate limit counts only successful sends
bot.mjs:65-68 and :96. Mails that fail after askApp/screenshot (error path bot.mjs:101) cost an app call and a Chromium start but are not counted. A mail flood from a spoofer therefore triggers unlimited serial work (one mail at a time, but unbounded per hour). Also `ignored` mails are not limited (cheap).
Fix: push into `state.replies` (or a separate `state.attempts`) right after the filter passes (before askApp), not after sendMail; also trim `state.replies` and `state.processed` (both grow forever, bot.mjs:39, 127) e.g. `state.processed = state.processed.slice(-500)`.

### L1 (low) Reply address case and group edge cases
bot.mjs:72 uses the raw address. Use `const from = OWNER` after the filter passed, so the reply always goes to the exact constant, never to a parsed string. One line fix: in handle(), `orig.from = OWNER` (bot.mjs:88).

## Prompt injection / HTML injection (mail.mjs)
- Attacker steers only the question and therefore the AI answer text in the reply to Robert. The answer comes from the d11-wien-chat app (its own system prompt). No tool in this bot executes mail text, no shell, no file path derived from mail text (file names use the IMAP uid, bot.mjs:84, 92).
- HTML: SAFE. `esc()` (mail.mjs:4) is applied to question, image src, link and cost; `mdToHtml` escapes the line first and only afterwards adds `<b>` and bullets (mail.mjs:6-14). No links or images from the answer are rendered, so no HTML or link injection. `esc` does not escape `'`; it is only used inside double quoted attributes and text, so not exploitable. The `<a href>` for APP_URL is a constant.
- `?q=` is built with encodeURIComponent in all three places (bot.mjs:93, mail.mjs:221, shot.mjs:209). SAFE.
- Subject header injection: nodemailer encodes headers, mailparser subject has no CR/LF. SAFE.
### L2 (low) Plain text part
mail.mjs:235 includes the raw answer text; a poisoned answer may contain a phishing URL that mail clients auto-link (HTML part does not). Fix: strip `https?://` from `answer.reply` in the text part or put a note "Links in der Antwort sind nicht geprueft".

## Secrets and privacy
- Env file: `~/.config/d11-mailbot.env` is chmod 600 (OK); `~/.env` 600 (OK). Keys: PUSH_SECRET 32, VIEW_KEY 32 chars (OK, strong enough). The secrets are not in docs, CLAUDE.md or the service file. The env loader copies only 3 variables (bot.mjs:31). `journalctl` shows only systemd start/stop lines; the bot never console.logs secrets (events.mjs:185 only logs dashboard errors).
- Local `out/events.jsonl` (644, events.mjs:11/112) holds full addresses, subjects and the first 300 chars of mail text in clear text. Local only, but the home directory is world-readable for other local users.
### M3 (medium) Other participants' mail metadata published
bot.mjs:75 emits `ignored` with `subject` and `from` for ALL mails in the shared inbox (12 desktops use it). maskEvent (events.mjs:74-83) masks only the email pattern, so subjects like `[d03] Testfrage Westbahnhof Prater` land in the public Worker KV (events.jsonl already shows this). Behind the view key, but still other people's data.
Fix: for reason 'Absender nicht erlaubt' emit `{reason}` only, without subject/from (bot.mjs:75): `const pub = reason === 'Absender nicht erlaubt' ? {} : {subject, from}; emit('ignored', {reason, ...pub});`. Do the same for bot.mjs:128 (already empty). Optionally also stop fetching `source` for mails whose envelope From is not the owner (see M4).
- Public push content: mail_in `text` (300 chars) and reply `reply` are pushed cut to 120 chars with emails masked (events.mjs:79). Phone numbers, names and addresses in the text are not masked. Low risk for a transport question bot; the dashboard in PUBLIC mode hides images and the preview (dashboard.html:106-108). Consider not pushing `text` of mail_in at all.
- Worker auth (worker/src/index.js):
  - eqSafe (worker/src/index.js:12-17) is a constant time comparison over the longer length; leaks only the length. OK. Empty secret is rejected (`!b`). OK.
  - Key in URL (`/?k=`): referrer is `no-referrer` (HEAD, index.js:7) so no leak via referrer; the key still ends up in browser history, Cloudflare logs and in the dashboard fetch URLs (dashboard.html:131-132). Low. Fix: send the key as a header (`x-view-key`) for the two API calls and keep `?k=` only for the first page load, or set a HttpOnly cookie after first load and redirect to `/`.
  - noindex: `x-robots-tag: noindex, nofollow` and `cache-control: no-store` are set on every response. OK.
  - CSP (index.js:4): `script-src 'unsafe-inline'` weakens XSS protection, but all event data goes through esc() (dashboard.html:80) before innerHTML. OK today; fix L3.
  - No brute force protection on `?k=`: 32 random chars make guessing impractical. Fine.
  - POST body length is checked after `req.text()` (index.js:29); an authenticated pusher only. Event fields are not whitelisted (only `type`), so a stolen push secret could store arbitrary JSON up to 4 KB x 100. Low. KV read-modify-write for events is racy and KV allows 1 write/s/key, bursts of events lose entries (cosmetic).
### L3 (low) CSP
Fix: move the inline script of public/dashboard.html (line 74) to a hash- or nonce-based CSP, or accept the risk; `connect-src 'self'` and `default-src 'none'` already prevent exfiltration.

## Local dashboard (events.mjs, public/dashboard.html)
- Binding: `server.listen(port, '127.0.0.1')` (events.mjs:186), verified with `ss`: 127.0.0.1:4411 only. OK.
- Methods: only GET. OK.
- /out/ traversal: name must match `^[a-z0-9._-]+\.(png|html)$`, no `..`, and a path prefix check (events.mjs:173-175). SAFE; no slashes possible. Note `.html` files from out/ are served as text/html in the dashboard origin without CSP; they contain only escaped content (mail.mjs), OK.
- XSS via subject/text/from: SAFE. dashboard.html builds HTML strings but every event field goes through `esc()` (lines 86-91, 103); `e.image` and the reply file name are `encodeURIComponent`-ed in src/href (106-108) and only in non-public mode; `e.link` is read (line 105) but never rendered. `esc` misses `'` which is irrelevant in the used contexts. `e.type` goes into `className` via esc() and into the TYPES whitelist in the Worker. OK.
### L4 (low) No Host/Origin check
Local server answers any Host header: DNS rebinding from a malicious web page in this desktop's Chrome could read /events (mail subjects, reply text). Fix: in the request handler `if (!/^(127\.0\.0\.1|localhost):4411$/.test(req.headers.host)) { res.writeHead(403); return res.end(); }`.
### L5 (low) SSE clients
`clients` Set and heartbeat are cleaned on close (events.mjs:162). No limit on connections; local only.

## Resources
- IMAP: ONE connection (bot.mjs:147), poll every 60 s (bot.mjs:161), 240 s poll timeout (159), reconnect with exponential backoff 30 s to 300 s (167). OK. `--check` and `--dry-run` open separate connections only when run manually.
- SMTP: a new transporter per mail (mail.mjs:246) with no explicit timeouts. Low: add `connectionTimeout: 15000, socketTimeout: 30000` and `transport.close()`.
- IMAP: ImapFlow has no explicit socket timeout config; add `socketTimeout`/`greetingTimeout` options (L6).
- Playwright: `browser.close()` in `finally` (shot.mjs:252); the launch timeout is not set, the navigation has 30 s, the wait 60 s. OK. If the 240 s poll timeout fires while Chromium runs, the browser is still closed by the finally once the Promise settles. The 240 s race does not cancel handle(); `busy=false` (bot.mjs:160) could let a second poll run in parallel with a still running screenshot. Low.
- askApp (ask-app.mjs:305-313): fetch without timeout; retries 3 times with 8-24 s sleeps; no AbortSignal. Fix: `signal: AbortSignal.timeout(60000)`.
### M4 (medium) No message size limit
bot.mjs:120 fetches the FULL source of every new mail in the shared inbox (including other participants' mails and any attachment) and `simpleParser` parses it in memory before any filter. A large mail (e.g. 50 MB) from anyone who knows support@nichtagentur.at can cause memory pressure on an 8 GB desktop.
Fix: first fetch `{ envelope: true, size: true, uid: true, internalDate: true }`; skip if `size > 2_000_000` or if `envelope.from[0].address.toLowerCase() !== OWNER`; only then fetch `source`. This also fixes M3 at the root (other people's mails never get parsed or logged).

## Priority list
- High: none.
- Medium: M1 sender authentication (Authentication-Results or subject token), M2 rate limit counting attempts and trimming state, M3 do not publish other people's subjects, M4 size limit and envelope pre-filter.
- Low: L1 use OWNER constant as reply address, L2 plain text links, L3 CSP unsafe-inline, L4 Host check, L5/L6 timeouts (SMTP, IMAP, app fetch), key in URL, state growth.
