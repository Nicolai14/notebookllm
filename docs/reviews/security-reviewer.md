# Review Security (Datum 2026-10-01)

Erstellt durch einen separaten Review-Agenten (nur lesend, eigener Kontext). Bewertung und Umsetzung der Befunde: siehe docs/reviews/findings-resolution.md.

## Zusammenfassung (3-5 Sätze)

Das Schutzmodell (App-seitige Autorisierung über eine zentrale DAL mit Pflicht-`sessionId`, RLS ohne Policies als Defense-in-Depth) ist im Code konsequent umgesetzt: Alle API-Routen rufen `requireSession()`, alle lesenden/löschenden DAL-Funktionen sind session-gescoped, Storage-Pfade bestehen nur aus generierten UUIDs, und es wurde kein IDOR-Pfad gefunden. Der gravierendste Befund ist die vertrauensselige Auswertung von `x-forwarded-for` (erstes, Client-kontrolliertes Element) im Login-Rate-Limit: In der geplanten Topologie (Cloudflare Flexible → Nginx:80 → Container) und erst recht bei Direktzugriff auf den Origin ist das Brute-Force-Limit auf das Demo-Passwort spoofbar und erlaubt zusätzlich gezieltes Aussperren fremder IPs. Daneben: Logout invalidiert die Session serverseitig nicht, der `COOKIE_SECURE=false`-Override greift auch in Produktion, und die KI-/Upload-Limits sind per Re-Login beliebig umgehbar (Kostenrisiko). Secrets gelangen weder ins Client-Bundle noch ins Repo noch in Logs/Fehlermeldungen; die Migrationen 001-003 sind bis auf eine Default-Privileges-Lücke für Funktionen sauber.

## Befunde

### [SCHWEREGRAD: hoch] Login-Rate-Limit über spoofbares `x-forwarded-for` aushebelbar (Brute-Force + gezielter Lockout)

- Stelle: `src/app/api/auth/login/route.ts:31-38`
- Nachweis: `const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";` — es wird das **erste** Element der XFF-Kette verwendet, und das ist immer Client-kontrolliert.
  - **Über Cloudflare (proxied):** Cloudflare hängt die echte Client-IP an eine bereits mitgesendete XFF-Liste **an**. Ein Angreifer sendet `X-Forwarded-For: 1.2.3.<n>` und erhält pro Request einen frischen Rate-Limit-Key `login:1.2.3.<n>` → das 10/15-Min-Limit (`RATE_LIMIT_LOGIN`, `src/lib/limits.ts:32`) ist wirkungslos, das Demo-Passwort (`DEMO_PASSWORD`, min. 8 Zeichen) ist unbegrenzt brute-force-bar. Umgekehrt kann er mit `X-Forwarded-For: <Opfer-IP>` 10 Fehlversuche gegen den Key des Opfers buchen und legitime Nutzer 15 Minuten aussperren (DoS).
  - **Direktzugriff auf den Origin:** Laut `docs/architecture.md` §9 lauscht Nginx auf Port 80 ohne erkennbare Beschränkung auf Cloudflare-IP-Ranges (Cloudflare "Flexible"). Wer `45.137.68.43:80` direkt anspricht, setzt XFF völlig frei — selbst eine korrekte Header-Auswertung hülfe dann nicht. (Nginx-Konfiguration liegt nicht im Repo; dieser Teil ist aus der dokumentierten Topologie abgeleitet, nicht aus Config-Dateien verifiziert.)
- Lösungsvorschlag: (1) In Nginx `proxy_set_header X-Forwarded-For $remote_addr;` setzen (Client-Werte verwerfen) oder das `real_ip`-Modul mit `set_real_ip_from` ausschließlich für Cloudflare-Ranges plus `CF-Connecting-IP` nutzen; (2) im Code das **letzte** Element der Kette (bzw. den von der eigenen Infrastruktur gesetzten Header) verwenden statt des ersten; (3) Origin-Port 80 per Firewall auf Cloudflare-IP-Ranges beschränken; (4) als Backstop ein globales Login-Limit (Key ohne IP) mit großzügigem Fenster ergänzen, damit „unknown"/gespoofte Keys nicht unbegrenzt skalieren.

### [SCHWEREGRAD: mittel] Logout invalidiert die Session serverseitig nicht — kopiertes Cookie bleibt bis zu 7 Tage gültig

- Stelle: `src/app/api/auth/logout/route.ts:5-15`; `src/lib/db/sessions.ts` (es existiert keine `deleteSession`-Funktion)
- Nachweis: Logout setzt nur das Browser-Cookie auf `""` (`maxAge: 0`). Die `sessions`-Zeile bleibt bestehen, und `getSessionId()` (`src/lib/auth/current.ts:19`) akzeptiert jedes zuvor ausgestellte, signierte Cookie, solange `exp` (7 Tage, `SESSION_TTL_MS`) nicht erreicht und die Zeile vorhanden ist. Ein vor dem Logout exfiltriertes Cookie (z. B. über die unverschlüsselte Cloudflare-Flexible-Origin-Strecke, §9 der Architektur) bleibt nach dem Logout voll gültig. Die Aussage in `docs/architecture.md` §4 („erneuter Login mit demselben Cookie ist nicht möglich, da das Cookie weg ist") gilt nur für den Browser des Nutzers, nicht für Kopien.
- Lösungsvorschlag: Im Logout-Handler zusätzlich die Session-Zeile löschen (`delete from sessions where id = ...` via neuer DAL-Funktion, Session-ID aus dem validierten Cookie); optional ein Cleanup für Sessions mit altem `last_seen_at`.

### [SCHWEREGRAD: mittel] KI-/Upload-Limits pro Session durch beliebig viele Logins umgehbar (Kostenrisiko)

- Stelle: `src/app/api/auth/login/route.ts:43-45` (jeder erfolgreiche Login erzeugt eine neue Session und **resettet** das Login-Limit); `src/app/api/notebooks/[id]/chat/route.ts:72-77` und `.../sources/route.ts:84-89` (Keys `ai:${sessionId}`, `upload:${sessionId}`)
- Nachweis: `resetRateLimit(rateLimitKey)` nach jedem Erfolg bedeutet, dass erfolgreiche Logins nie limitiert sind. Wer das (geteilte) Demo-Passwort kennt, kann in einer Schleife einloggen und pro frischer Session erneut 60 KI-Anfragen/h bzw. 30 Uploads/Tag verbrauchen — die OpenAI-Kosten sind damit effektiv nur durch die spoofbare Login-IP (siehe Befund 1) begrenzt.
- Lösungsvorschlag: Minimal: zusätzliches globales Limit für Session-Erzeugung und/oder globale Obergrenzen für `ai:`/`upload:`-Hits (Key ohne Session-ID, z. B. `ai:global`), passend zum ohnehin vorhandenen Kill-Switch `AI_FEATURES_ENABLED`.

### [SCHWEREGRAD: mittel] `COOKIE_SECURE=false` deaktiviert das Secure-Attribut auch in Produktion

- Stelle: `src/lib/auth/cookie.ts:7-10`
- Nachweis: `if (process.env.COOKIE_SECURE === "false") return false;` greift **vor** der `NODE_ENV`-Prüfung. Eine einzelne, für E2E-Läufe gedachte Env-Variable, versehentlich in der Produktions-`.env` gesetzt, liefert das `nb_session`-Cookie ohne `Secure` aus — es würde dann auch über reine HTTP-Aufrufe des Origins (Port 80 ist in der Zieltopologie offen) mitgesendet. Es gibt keinen Schutz (Warnung/Assertion) gegen diese Fehlkonfiguration.
- Lösungsvorschlag: Override nur außerhalb von Produktion zulassen (`NODE_ENV !== "production" && COOKIE_SECURE === "false"`) oder beim Start laut warnen/abbrechen, wenn beide kombiniert sind. Ergänzend `__Host-`-Prefix für den Cookie-Namen erwägen (erzwingt Secure + Path=/).

### [SCHWEREGRAD: niedrig] Nicht-konstanter Vergleich der HMAC-Signatur

- Stelle: `src/lib/auth/session.ts:64-67`
- Nachweis: `if (signature !== expected) return null;` — der Kommentar begründet das mit „Vergleich zweier HMAC-Outputs", aber `signature` ist **Angreifer-kontrolliert**, nur `expected` ist ein HMAC-Output. Ein Timing-Orakel auf dem String-Vergleich könnte theoretisch `HMAC(encoded)` für ein gewähltes Payload byte-weise rekonstruieren und so ein Cookie fälschen. Praktische Ausnutzung ist stark eingeschränkt (JS-String-Vergleich über Netz kaum messbar; ein gefälschtes Cookie braucht zusätzlich eine existierende Session-UUID, da `touchSession` die Zeile prüft) — daher niedrig.
- Lösungsvorschlag: Double-HMAC-Vergleich (beide Seiten erneut HMACen und dann vergleichen) oder beide Werte dekodieren und mit konstantzeitigem Byte-Vergleich prüfen; minimaler Eingriff in `verifySessionCookieValue`.

### [SCHWEREGRAD: niedrig] Doku-Code-Abweichung: dokumentierte Auth-Middleware existiert nicht

- Stelle: `docs/architecture.md` §4 („Eine Middleware prüft das Session-Cookie für alle Routen außer Login/Health"); kein `src/middleware.ts` im Repo (per Dateiliste verifiziert)
- Nachweis: Die beschriebene Middleware-Schicht fehlt. Faktisch kompensiert: alle API-Routen rufen `requireSession()`/`getSessionId()` und beide Pages (`src/app/page.tsx:9-10`, `src/app/notebooks/[id]/page.tsx:15-16`) prüfen serverseitig. Es wurde keine Route ohne Prüfung gefunden (außer bewusst `api/health`). Risiko ist damit dokumentarisch, aber die zweite Verteidigungslinie, auf die sich das Schutzmodell beruft, fehlt — eine künftig ergänzte Route ohne `requireSession()` wäre ungeschützt.
- Lösungsvorschlag: Entweder die Middleware minimal nachrüsten (Cookie-Signaturprüfung für alles außer `/login`, `/api/auth/login`, `/api/health`) oder den Satz in `docs/architecture.md` §4 streichen/anpassen.

### [SCHWEREGRAD: niedrig] Unvertrauenswürdige PDFs werden inline same-origin ausgeliefert; keine CSP

- Stelle: `src/app/api/sources/[id]/file/route.ts:24-37`; `next.config.ts` (keine Header-Konfiguration, nur `poweredByHeader: false`)
- Nachweis: Hochgeladene PDFs (nur Magic-Byte-geprüft, Inhalt beliebig) werden mit `Content-Disposition: inline` unter dem App-Origin gerendert. Browser-PDF-Viewer sandboxen eingebettetes PDF-JavaScript, daher kein direkter XSS-Nachweis — aber die Auslieferung aktiver Fremdinhalte vom eigenen Origin ohne jede CSP ist ein unnötiges Restrisiko (historische Viewer-Bugs). TXT/MD sind korrekt als `text/plain` + `nosniff` entschärft.
- Lösungsvorschlag: Dem File-Proxy-Response zusätzlich `Content-Security-Policy: sandbox` mitgeben (PDF rendert weiterhin, Skript-/DOM-Zugriff auf den Origin ist unterbunden); optional eine globale CSP über `headers()` in `next.config.ts`.

### [SCHWEREGRAD: niedrig] Default Privileges nur für Tabellen widerrufen, nicht für Funktionen

- Stelle: `supabase/migrations/002_security_hardening.sql:18-19`; `supabase/migrations/003_rate_limits.sql:57-60`
- Nachweis: 002 widerruft `all on all tables` plus `alter default privileges ... on tables`. Funktionen erhalten in Postgres aber standardmäßig `EXECUTE` für `PUBLIC`; 003 muss deshalb `rate_limit_hit`, `rate_limit_reset` und `match_chunks` einzeln revoken. Jede künftig angelegte Funktion wäre ohne manuellen Revoke wieder für `anon`/`authenticated` aufrufbar — eine stille Lücke im sonst harten Modell. (`search_path` ist in 002/003 korrekt gepinnt, kein `SECURITY DEFINER` im Einsatz — die Funktionen laufen als INVOKER, was hier richtig ist.)
- Lösungsvorschlag: In einer Folge-Migration `alter default privileges in schema public revoke all on functions from public, anon, authenticated;` ergänzen.

## Positiv (kurz)

- **Keine IDOR-Pfade gefunden:** Alle lesenden/löschenden DAL-Funktionen erzwingen `session_id` (`notebooks.ts` per `.eq("session_id", ...)`, `sources.ts:94-96` per `notebooks!inner`-Join); unscoped Helfer (`insertChunks`, `listChunksBySources`, `updateSourceStatus`, `insertMessage`, `countSources`) werden ausnahmslos erst nach Session-Validierung aufgerufen; `match_chunks` ist auf Notebook + explizite Source-Liste beschränkt; Chat/Summary filtern `sourceIds` gegen die session-validierte Liste (keine Fremd-IDs möglich).
- **Datei-Proxy solide:** Autorisierung via `getSource(sessionId, id)`, privater Bucket (per `scripts/db-apply.mjs` `public: false`), Content-Type-Whitelist (PDF oder `text/plain`), `nosniff`, `Cache-Control: private, no-store`, Dateiname für `Content-Disposition` ASCII-saniert (CR/LF/Quotes entfernt → keine Header-Injection); Storage-Pfade bestehen nur aus `sessionId/notebookId/UUID`, nie aus Dateinamen.
- **Secrets:** Kein `NEXT_PUBLIC_*` im Code, `server-only`-Importe in `db/client.ts`, `openai.ts`, Auth/DAL; `.env` in `.gitignore`, nicht in `git ls-files` und nie in der Historie; Logs/Fehlermeldungen geben keine Secret-Werte aus (Zod-Fehler nennen nur Pfade, `toAiServiceError` loggt nur `err.message`); unerwartete Fehler werden zu generischen 500ern.
- **XSS:** Kein `dangerouslySetInnerHTML`/Raw-HTML im gesamten `src/`; Antworten, Passagen, Dateinamen und Fehlermeldungen werden ausschließlich über React-Escaping als Text gerendert (`answer-text.tsx`, `citation-chip.tsx`); Upload prüft Endung + Magic Bytes + Null-Byte-Heuristik und saniert Dateinamen (Steuerzeichen, Pfadtrenner, Länge).
- **Rate-Limit-Mechanik atomar:** `rate_limit_hit` per `INSERT ... ON CONFLICT DO UPDATE` (Row-Lock, keine Race-Lücke), abgelehnte Hits verlängern das Fenster nicht; Passwortvergleich timing-sicher über `timingSafeEqual` auf SHA-256-Digests; Cookie `HttpOnly` + `SameSite=Lax` + `Path=/`.
