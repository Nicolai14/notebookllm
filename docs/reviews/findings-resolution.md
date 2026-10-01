# Bewertung und Umsetzung der Review-Befunde (2026-10-01)

Bewertung durch den Hauptagenten nach den drei lesenden Reviews (`test-engineer.md`, `rag-reviewer.md`, `security-reviewer.md`) und dem ersten Evaluationslauf (12/17, `../eval/report-2026-10-01.md`). Status: **behoben** (Code/Tests geändert, Regression grün), **teilweise** (Risiko reduziert, Rest dokumentiert), **akzeptiert** (bewusste Einschränkung), **offen** (für M9 bzw. später eingeplant).

## Security

| Befund | Schweregrad | Status | Umsetzung |
|---|---|---|---|
| Login-Rate-Limit über spoofbares `x-forwarded-for` | hoch | **behoben** | `getClientIp` nutzt nur noch einen explizit konfigurierten vertrauenswürdigen Header (`CLIENT_IP_HEADER`, z. B. `cf-connecting-ip`), davon das **letzte** Element; ohne Konfiguration teilen sich alle Clients einen Bucket (grob, aber nicht umgehbar). Zusätzlich globales Login-Backstop-Limit (100/15 min) ohne IP im Key. Nginx-/Firewall-Empfehlungen übernehme ich in die M9-Deployment-Schritte. |
| Logout invalidiert Session nicht serverseitig | mittel | **behoben** | Logout löscht die Session-Zeile (kopierte Cookies werden wertlos); da die Kaskade damit auch die Daten der Sitzung entfernt, bestätigt die UI den Logout mit einem Hinweis. Test: kopiertes Cookie liefert nach Logout 401. |
| KI-/Upload-Limits per Re-Login umgehbar | mittel | **behoben** | Globale Backstops `ai-global` (300/h) und `upload-global` (150/Tag) zusätzlich zu den Session-Limits. |
| `COOKIE_SECURE=false` wirkt auch in Produktion | mittel | **teilweise** | Laute Startwarnung beim Override. Ein harter Block ist nicht praktikabel, weil `next start` immer `NODE_ENV=production` setzt und die E2E-Suite den Override braucht; die Deployment-`.env` (M9) setzt die Variable nicht. |
| Nicht-konstanter HMAC-Vergleich | niedrig | **behoben** | Double-HMAC-Vergleich (beide Seiten erneut ge-HMAC-t, kein Timing-Signal auf Angreifer-kontrollierten Werten). |
| Dokumentierte Middleware existiert nicht | niedrig | **behoben** | `docs/architecture.md` §4 korrigiert: Guards liegen in jeder Route und jeder Page, es gibt bewusst keine Middleware-Schicht. |
| PDFs inline same-origin ohne CSP | niedrig | **behoben** | Datei-Proxy sendet `Content-Security-Policy: sandbox`. |
| Default-Privileges-Lücke für Funktionen | niedrig | **behoben** | Migration 004 (`alter default privileges ... revoke on functions` + Sweep über Bestandsfunktionen), angewendet. |

## RAG

| Befund | Schweregrad | Status | Umsetzung |
|---|---|---|---|
| Zusammenfassungs-Reihenfolge hängt an zufälliger UUID-Sortierung | hoch | **behoben** | Summary-Route sortiert Chunks deterministisch nach Upload-Reihenfolge der ausgewählten Quellen; von Eval-Lauf 1 (Fall 15) praktisch bestätigt. |
| Reduce kann Marker verschieben, Validierung prüft nur Bereich | mittel | **behoben** | Im Staged-Pfad sind nur Marker gültig, die in den Map-Zwischenergebnissen tatsächlich vorkommen; alles andere wird vor der Validierung entfernt. Restrisiko (gültiger Marker an falscher Aussage) bleibt wie im Chat dokumentiert. |
| Faithfulness-Judge bei 0 Zitaten übersprungen | mittel | **behoben** | Eval-Runner wertet eine zitatlose Antwort bei `judgeFaithfulness` als fehlgeschlagenen Check; Fall 12 verlangt jetzt Zitate. |
| Summary-Judge sieht nur 6k Zeichen | mittel | **behoben** | 12k Zeichen plus expliziter Gekürzt-Hinweis im Judge-Prompt (nur Widersprüche zum gezeigten Teil werten). |
| Judge = geprüftes Modell | mittel | **teilweise** | Optionales `OPENAI_JUDGE_MODEL`; der Report kennzeichnet Selbstbewertung explizit. Ein separates Judge-Modell ist eine Modellentscheidung des Auftraggebers (offen). |
| History ohne Token-Budget; Summary-im-Verlauf ungetestet | mittel | **behoben** | History-Aufbau mit Token-Budget (4k, von hinten, Kappung überlanger Nachrichten); neue Eval-Fälle 17a/17b (Zusammenfassung im Verlauf, dann Quellenwechsel). |
| Retrieval-Budget bricht ab statt zu überspringen | niedrig | **behoben** | `continue` statt `break`. |
| Marker-Stripping trifft User-Messages | niedrig | **behoben** | Stripping nur noch für Assistant-Nachrichten. |
| Whitespace-Bereinigung/Marker in Code-Fences | niedrig | **akzeptiert** | Randfall ohne Sicherheitswirkung; als bekannte Einschränkung dokumentiert. |
| Leere Map-Partials verschwinden still | niedrig | **behoben** | Von Eval-Lauf 1 als realer Fehler bestätigt (Reasoning-Tokens zehrten das Map-Budget auf → leere Partials → unbrauchbare Zusammenfassung). Fix: Map-Budget 1500, leere Partials werden als Auslassung ausgewiesen, nur leere Partials ⇒ klarer Fehler statt leerem Reduce, `finish_reason=length` wird geloggt. |
| Refusal-Heuristik false-positive-trächtig | niedrig | **behoben** | Muster v2 (präziser, inkl. real beobachteter Formulierungen; `geht aus den` entfernt), Änderung im Datenset dokumentiert. |
| User-Frage vor Modellaufruf persistiert | niedrig | **akzeptiert** | Bewusstes Verhalten (Frage bleibt bei Fehlern im Verlauf sichtbar); per Test festgeschrieben (errors.spec: letzte Nachricht ist die User-Frage, kein Assistant-Fragment). |

## Test Engineering

| Befund | Schweregrad | Status | Umsetzung |
|---|---|---|---|
| Keine Fehlerinjektion, KI-Fehlerpfade ungetestet | hoch | **behoben** | Mock-Endpunkt `/__fail` (n Fehlversuche pro Ziel, SDK-Retries berücksichtigt); neue Tests: Upload endet bei Embedding-Fehler in `error` mit KI-Dienst-Meldung, Chat-Fehler kommt als SSE-`error`-Event, keine halbe Antwort im Verlauf. |
| SSE-Client-Abbruch crasht Stream / Kosten laufen weiter | hoch | **teilweise** | Code behoben: `cancel()`-Handler, abbruchsicheres `send`, OpenAI-Stream wird abgebrochen, kein Persistieren halber Antworten. Ein automatisierter Client-Abbruch-Test fehlt noch (offen, geringes Restrisiko da Pfad jetzt defensiv). |
| Verarbeitungs-Timeout ungetestet; Race schreibt verwaiste Chunks | mittel | **behoben** | Timeout-Guard verhindert Chunk-Inserts der Verlierer-Promise; Unit-Tests für Timeout (inkl. Nachweis, dass die verspätete Pipeline nichts mehr schreibt) und für das Extraktionslimit. Das Race wurde im ersten Testlauf real nachgewiesen, dann gefixt. |
| Keine CI-Pipeline | mittel | **offen (M9)** | Exitcodes propagieren korrekt; GitHub-Actions-Workflow samt Secrets-/Test-DB-Strategie wird mit dem Deployment (M9) aufgesetzt. |
| Grenzwerte ungetestet (Upload-Limit, Fragelänge, Extraktion) | mittel | **behoben** | Tests: Upload-Limit 429 + Retry-After + kein OpenAI-Aufruf; Frage > 2000 Zeichen 400; Extraktionslimit-Unit-Test. |
| TOCTOU beim 10-Quellen-Limit | mittel | **akzeptiert** | Check-then-act kann im Extremfall 1-2 Quellen Überschuss zulassen; Schaden minimal, globale Upload-Limits deckeln die Kosten. Dokumentiert. |
| selection.spec kann leer durchlaufen | mittel | **behoben** | Beide legitime Ausgänge werden jetzt explizit geprüft (Refusal-Text oder ausschließlich erlaubte Zitate), kein vakuumleerer PASS mehr. |
| Eval `.every()` auf leeren Listen / Judge-Skip | mittel | **behoben** | Siehe RAG (Judge-Skip wird FAIL-Check; Fall 12 verlangt Zitate). |
| Flakiness: `login:unknown`, geteilte DB | mittel | **behoben/teilweise** | Login-Tests nutzen eindeutige `x-forwarded-for`-Buckets und räumen ihre Keys (inkl. `login-global`) auf; Testserver setzen `CLIENT_IP_HEADER`. Die geteilte Supabase-DB bleibt (Demo-Setup, dokumentiert); eine dedizierte Test-DB ist für M9/CI vorgesehen. |
| Staged-Summary-Test beweist den Pfad nicht | niedrig | **behoben** | `/__reset` + Assertion `stats.chat > 1`. |
| Marker ≥5 Ziffern bleiben stehen, `[01]`-Mapping | niedrig | **behoben** | Regex ohne Obergrenze, Marker werden normalisiert (`[01]` → `[1]`); zwei neue Unit-Tests. |
| Eval-Runner: Setup-Fehler verwerfen Ergebnisse, Datum fix | niedrig | **behoben** | Setup pro Fall im try (Setup-Fehler = FAIL des Falls), Zeitstempel im Dateinamen. |
| Verwaiste User-Message ungetestet | niedrig | **behoben** | errors.spec schreibt das Verhalten fest. |

## Nicht nachträglich veränderte Evaluationsergebnisse

Lauf 1 (12/17) bleibt unverändert unter `docs/eval/report-2026-10-01.md` dokumentiert. Für Lauf 2 wurden ausschließlich (a) Produktfehler behoben, (b) nachweislich fehlerhafte Checker-Heuristiken korrigiert und (c) ein Konstruktionsfehler des Datensets (zu kleine Langdokumente für die Deckel-Szenarien) behoben; alle Änderungen sind im Kopf von `scripts/eval/dataset.mjs` und im Lauf-2-Report ausgewiesen. Die inhaltlichen Erwartungen (Zahlen, Belegstellen, Verweigerungen) blieben unverändert.
