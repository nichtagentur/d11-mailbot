# d11-mailbot

Email bot for Wien Chat. Answers mails to support@nichtagentur.at ONLY when the sender is MAILBOT_OWNER (secret, Roberts Adresse; local: ~/.config/d11-mailbot.env).
Replies carry a screenshot plus links to https://d11-wien-chat.nichtagentur.workers.dev.
Live view: local dashboard http://localhost:4411 and Worker d11-mailbot (secret link). Contract: docs/contract.md.
Rules: shared inbox, ONE IMAP connection, poll at most every 60 s, BODY.PEEK (change no flags), ignore old mails. Never print secrets.
Polls INBOX and Junk (easyname puts some real mails, e.g. with empty subject, into Junk). Owner mails must carry the topmost Received-SPF: pass with envelope-from <owner-domain> (easyname sets no Authentication-Results). One-time catch-up after a restart: env MAILBOT_SINCE=<ISO time>.
