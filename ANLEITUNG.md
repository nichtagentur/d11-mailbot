# Wien Chat + Mail-Bot: Anleitung nach dem Workshop

Stand: 14.10.2026, Workshop Wien, Desktop 11 (Robert).
Alles läuft in der Cloud, du brauchst die Workshop-Instanz nicht mehr.

## 1. Was läuft wo

| Teil | Wo | Adresse |
|---|---|---|
| Chat-App (Fahrplan-KI, Karten, Kosten) | Cloudflare Worker `d11-wien-chat` | https://d11-wien-chat.nichtagentur.workers.dev |
| Mail-Bot | GitHub Actions, alle 5 Minuten | https://github.com/nichtagentur/d11-mailbot/actions |
| Live-Dashboard des Bots | Cloudflare Worker `d11-mailbot` | geheimer Link, steht in der E-Mail (nicht weitergeben) |
| Code der Chat-App | GitHub | https://github.com/nichtagentur/d11-wien-chat |
| Code des Mail-Bots | GitHub | https://github.com/nichtagentur/d11-mailbot |

## 2. Nutzen

- **Chat-App:** einfach die Adresse öffnen und fragen, z. B. "Wann kommt die nächste U1 am Stephansplatz?" oder "Wie komme ich vom Westbahnhof zum Stephansdom?". Direktlink mit Frage: `https://d11-wien-chat.nichtagentur.workers.dev/?q=<Frage>`.
- **Mail-Bot:** schreib von **<deine Adresse>** an **support@nichtagentur.at**. Betreff oder Text = deine Frage. Die Antwort kommt mit Bild (Karte/Abfahrtstafel), Button "In der App öffnen" und Kostenangabe.
  - Wartezeit: GitHub startet den Bot alle 5 Minuten, in Stoßzeiten auch erst nach 10 bis 15 Minuten. Rechne mit bis zu 15 Minuten.
  - Der Bot antwortet nur auf diese eine Adresse. Gefälschte Absender (ohne SPF-Bestätigung deiner Domain) werden ignoriert.
  - Er schaut auch in den Spam-Ordner des Postfachs.
  - Maximal 10 Antworten pro Stunde.
  - Klappt eine Antwort nicht (z. B. KI-Dienst gestört), bekommst du eine kurze Fehlermail und kannst die Frage einfach nochmal schicken.
  - Fragen außerhalb Wiens (z. B. Flughafen) beantwortet er mit einem Hinweis, dass das außerhalb der Wiener Linien liegt.
- **Dashboard:** zeigt jeden Lauf, jede Mail (fremde Absender nur als "Mail eines anderen Absenders") und die Kosten.

## 3. Was am Workshop hängt (wichtig)

Alles läuft auf den **Workshop-Konten** (GitHub `nichtagentur`, Cloudflare `nichtagentur`, Postfach `support@nichtagentur.at`). Das heißt:

1. **Kein Zugriff zum Ändern:** Du hast keine Logins für diese Konten. Nutzen geht, ändern nur nach Umzug (Abschnitt 5) oder über den Trainer Franz Enzenhofer.
2. **Kann abgeschaltet werden:** Der Trainer kann die Konten oder das Postfach nach dem Workshop aufräumen. Dann sind App und Bot weg. Der Code liegt auf GitHub, solange das Konto besteht. **Lade ihn dir gleich herunter** (Abschnitt 4).
3. **OpenRouter-Schlüssel:** Die KI-Antworten laufen über deinen eigenen OpenRouter-Schlüssel (Guthaben für einen Monat). Ist er leer oder abgelaufen, antwortet die App mit einer Fehlermeldung. Solange alles auf den Workshop-Konten liegt, kann nur der Trainer einen neuen Schlüssel eintragen. Nach dem Umzug machst du es selbst: neuen Schlüssel auf https://openrouter.ai holen, `npx wrangler secret put OPENROUTER_API_KEY` (Abschnitt 5, Schritt 2).
4. **GitHub pausiert Zeitpläne:** Nach 60 Tagen ohne Änderung schaltet GitHub Zeitpläne normalerweise ab. Der Bot meldet sich deshalb bei jedem Lauf selbst wieder aktiv (Keepalive). Falls er trotzdem verstummt: Actions > d11-mailbot > "Enable workflow".
5. **Kosten:** pro Antwort etwa 0,1 Cent (DeepSeek über OpenRouter). GitHub Actions ist bei öffentlichen Repositories kostenlos, Cloudflare Workers im Gratis-Tarif.

## 4. Code sichern (5 Minuten, jetzt machen)

Auf deinem Laptop, mit installiertem Git:

```bash
git clone https://github.com/nichtagentur/d11-wien-chat.git
git clone https://github.com/nichtagentur/d11-mailbot.git
```

Ohne Git: auf GitHub jeweils "Code" > "Download ZIP".
Es stehen keine Passwörter oder Schlüssel im Code. Die liegen nur als Secrets bei Cloudflare und GitHub.

## 5. Auf eigene Konten umziehen (dann kannst du alles ändern)

Am einfachsten mit **Claude Code** auf deinem Laptop: in den Ordner `d11-mailbot` wechseln, `claude` starten und sagen:
"Zieh beide Projekte auf meine eigenen Konten um, folge ANLEITUNG.md Abschnitt 5." Die Logins machst du selbst, den Rest erledigt Claude.

Von Hand:

1. **Konten:** kostenlos anlegen: https://dash.cloudflare.com/sign-up und https://github.com/signup. Node.js installieren (https://nodejs.org).
2. **Chat-App** (Ordner `d11-wien-chat`):
   ```bash
   npx wrangler login                        # Cloudflare-Login im Browser
   npx wrangler secret put OPENROUTER_API_KEY   # deinen OpenRouter-Schlüssel einfügen
   npx wrangler deploy                       # gibt deine neue Adresse aus, z. B. https://d11-wien-chat.<dein-name>.workers.dev
   ```
3. **Dashboard** (Ordner `d11-mailbot/worker`):
   ```bash
   npx wrangler kv namespace create EVENTS   # die ausgegebene id in worker/wrangler.toml bei "id =" eintragen
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # 1. Zufallswert = PUSH_SECRET, notieren
   node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"   # 2. Zufallswert = VIEW_KEY (Dashboard-Schlüssel), notieren
   npx wrangler secret put PUSH_SECRET       # 1. Wert einfügen
   npx wrangler secret put VIEW_KEY          # 2. Wert einfügen
   npx wrangler deploy                       # Dashboard: https://d11-mailbot.<dein-name>.workers.dev/?k=<VIEW_KEY>
   ```
4. **Mail-Bot** (Ordner `d11-mailbot`): neues Repository auf GitHub anlegen und den Code hochladen. Dann unter Settings > Secrets and variables > Actions eintragen:
   - Secrets: `SMTP_PASS` (Passwort des Bot-Postfachs), `MAILBOT_OWNER` (= <deine Adresse>), `MAILBOT_PUSH_URL` (Dashboard-Adresse ohne `?k=`), `MAILBOT_PUSH_SECRET` (aus Schritt 3).
   - Variables: `MAILBOT_APP_URL` (deine neue App-Adresse aus Schritt 2).
   - Unter Settings > Actions > General > Workflow permissions "Read and write permissions" wählen (für den eingebauten Keepalive gegen die 60-Tage-Pause).
   - Für ein **eigenes Postfach** zusätzlich die Variables `MAILBOT_USER` (Adresse des Bots), `MAILBOT_IMAP_HOST`, `MAILBOT_SMTP_HOST` (aus den Einstellungen deines Mail-Anbieters; IMAP Port 993, SMTP Port 587). Heißt der Spam-Ordner dort anders (z. B. `Spam`), die Variable `MAILBOT_FOLDERS` setzen, z. B. `INBOX,Spam`.
   - Hinweis: Die Echtheitsprüfung des Absenders liest den Header `Received-SPF`. Den setzt nicht jeder Mail-Anbieter. Bei einem anderen Anbieter vorher eine Testmail im Dashboard prüfen. Wird sie als "Absender nicht verifiziert" ignoriert, Claude Code bitten, die Prüfung an den Anbieter anzupassen.
5. **Testen:** Actions > d11-mailbot > "Run workflow", im Feld "Testfrage" z. B. "Wie komme ich vom Westbahnhof zum Stephansdom?" eintragen. Du bekommst eine Test-Antwort per Mail. Danach eine echte Mail schicken und im Dashboard zusehen.

## 6. Ändern und erweitern

- **Mit Claude Code** (empfohlen): Ordner öffnen, `claude` starten, Wunsch beschreiben (z. B. "Zeig in der Antwortmail zusätzlich die Abfahrtstafel"). Danach:
  - Chat-App: `npx wrangler deploy` im Ordner `d11-wien-chat`.
  - Mail-Bot: Änderungen auf GitHub hochladen (`git add -A && git commit -m "..." && git push`). Der nächste Lauf nutzt den neuen Code.
- **Lokal testen ohne Mail zu senden** (Ordner `d11-mailbot`):
  ```bash
  npm install
  npx playwright install chromium
  MAILBOT_OWNER=owner@example.com node bot.mjs --dry-run test/beispiel.eml
  ```
  Ergebnis: `out/reply-dry-beispiel.html` (so sieht die Antwortmail aus). Unter Windows in PowerShell statt der letzten Zeile: `$env:MAILBOT_OWNER="owner@example.com"; node bot.mjs --dry-run test/beispiel.eml`.
- **Wichtige Dateien:**
  - `d11-wien-chat/src/worker.js`: KI-Logik und Echtzeitdaten.
  - `d11-wien-chat/public/`: Oberfläche, Karten, Routen.
  - `d11-mailbot/bot.mjs`: Postfach, Filter, Ablauf.
  - `d11-mailbot/mail.mjs`: Aussehen der Antwortmail.
  - `d11-mailbot/shot.mjs`: Screenshot.
  - `d11-mailbot/.github/workflows/mailbot.yml`: Zeitplan.
- **Bot anhalten:** GitHub > Actions > d11-mailbot > "..." > "Disable workflow".
