# Implementierungsplan

Kleine, einzeln abnehmbare Meilensteine. Jeder Meilenstein endet mit erfüllten Akzeptanzkriterien und laufenden Tests der bisherigen Meilensteine. Der Kern-Durchstich (Upload → Frage → Antwort → anklickbare Quelle) kommt bewusst früh (M2), damit das Risiko im RAG-Kern zuerst abgebaut wird.

Referenz für alle Design-Entscheidungen: `docs/architecture.md`.

## M1: Fundament (Projekt, Konfiguration, Auth, Schema)

Umfang:

- Next.js-Projekt (App Router, TypeScript, Tailwind, shadcn/ui), Vitest und Playwright eingerichtet.
- `config`-Modul mit zod-Validierung aller ENV-Variablen; `embedding_config`-Abgleich implementiert.
- DB-Migrationen: alle Tabellen aus der Architektur, pgvector-Spalte mit ENV-Dimension.
- Login/Logout mit `DEMO_PASSWORD`, signiertes HttpOnly-Session-Cookie, Auth-Middleware, `/api/health`.
- Zentrale Data-Access-Schicht mit Session-Scope-Pflicht.

Akzeptanzkriterien:

- [ ] App startet nicht bzw. meldet präzise, welche ENV-Variable fehlt oder ungültig ist.
- [ ] Falsches Passwort → Fehlermeldung; richtiges Passwort → Session-Cookie (HttpOnly, Secure, SameSite=Lax); Logout entfernt es.
- [ ] Jede Route außer Login/Health antwortet ohne gültiges Cookie mit 401 (Test).
- [ ] Migrationen laufen idempotent gegen eine leere Supabase-DB; Embedding-Dimension stammt nachweislich aus der ENV.
- [ ] Absichtlich veränderte `OPENAI_EMBEDDING_DIMENSIONS` gegen bestehendes Schema → AI-Endpunkte liefern den definierten Konfigurationsfehler (Test).

## M2: Vertikaler Durchstich: Upload → Frage → Antwort → anklickbare Quelle

Umfang (bewusst schmal: nur TXT, ein Notebook implizit, minimale UI):

- Notebook anlegen/öffnen (einfachste Form), TXT-Upload mit Validierung, Storage-Ablage.
- Verarbeitung: Extraktion, Chunking (Absätze, Zielgröße, Überlappung), OpenAI-Embeddings; läuft vollständig im Upload-Request mit Verarbeitungslimits (extrahierte Tokens, Timeout) und endet deterministisch mit ready oder error samt verständlicher Meldung. Status-Polling nur zur Anzeige.
- Chat-Endpunkt: Embedding der Frage, pgvector-Suche (Notebook-Scope), Prompt mit nummerierten Chunks, SSE-Streaming, Persistierung.
- Zitatvalidierung serverseitig; Zitat-Chips in der UI, Klick zeigt Datei, Abschnitt und Original-Passage.
- Keine-Antwort-Pfad (keine Treffer über Schwelle → Standardantwort ohne Modellaufruf).

Akzeptanzkriterien:

- [ ] TXT hochladen → Status wird sichtbar "ready" → Frage zum Inhalt → gestreamte Antwort mit mindestens einem Zitat-Chip.
- [ ] Klick auf den Chip zeigt Dateiname, Abschnitt und die tatsächliche Passage aus der DB.
- [ ] Frage ohne Bezug zu den Quellen → definierte "keine Basis in den Quellen"-Antwort, kein allgemeines Modellwissen.
- [ ] Verarbeitungslimits greifen: Quelle über dem Token-Limit und Timeout-Fälle enden im Status `error` mit verständlicher Meldung; es bleiben keine Quellen dauerhaft in `processing` (Tests).
- [ ] Ungültige `[n]`-Marker in Modell-Fixtures werden entfernt (Unit-Test); Metadaten der Zitate kommen aus der DB, nicht aus dem Modelltext.
- [ ] Playwright-Durchstich (gegen OpenAI-Mock) läuft grün: Login → Upload → Frage → Antwort → Chip → Passage sichtbar.

## M3: Vollständige Quellenverwaltung (PDF, Markdown, Notebooks, Fehler)

Umfang:

- Notebook-Übersicht: erstellen, öffnen, löschen (mit Kaskade inkl. Storage).
- PDF-Extraktion mit Seitenzuordnung (unpdf), Markdown mit Überschriftenpfaden; Chunking strukturbewusst gemäß Architektur.
- Quellen löschen (Kaskade), Originaldatei-Anzeige über den autorisierten Datei-Proxy (PDF-Viewer, TXT/MD-Ansicht).
- Fehlerpfade: passwortgeschütztes PDF, PDF ohne Textebene, Limit extrahierter Tokens, PDF-Seitenlimit, Verarbeitungs-Timeout, ungültiger Dateityp (Magic Bytes), je mit verständlicher Meldung.
- Limits: 5 MB pro Datei, 10 Quellen pro Notebook, max. PDF-Seiten.

Akzeptanzkriterien:

- [ ] PDF-Chunks tragen korrekte `page_start`/`page_end`; Markdown-Chunks korrekte `section_path` (deterministische Tests mit Fixture-Dateien).
- [ ] Zitat aus einem PDF zeigt die richtige Seitenzahl; Klick öffnet die Quelle.
- [ ] Jeder definierte Fehlerpfad zeigt seine verständliche Meldung; die Quelle steht auf `error` und blockiert nichts anderes.
- [ ] 6-MB-Datei und 11. Quelle werden serverseitig abgelehnt (Tests, nicht nur UI).
- [ ] Notebook löschen entfernt Quellen, Chunks, Nachrichten und Storage-Dateien vollständig (Test zählt Reste = 0).

## M4: Quellenauswahl, Chatverlauf, Sessions-Trennung komplett

Umfang:

- Quellen-Checkboxen; Chat und Zusammenfassung nutzen nur ausgewählte Quellen; serverseitige Validierung der Auswahl gegen das Notebook.
- Persistierter Chatverlauf pro Notebook, Laden beim Öffnen; Zitat-Snapshots überleben Quellen-Löschung ("Quelle gelöscht"-Zustand).
- IDOR-Testmatrix: zwei Sessions, alle Endpunkte.
- Dreispaltiges Layout (Sources / Chat / Studio-Platzhalter) in finaler Struktur, eigenes Branding.

Akzeptanzkriterien:

- [ ] Abgewählte Quelle taucht in keiner Antwort mehr auf (Test über Retrieval-Filter mit Fake-Embeddings).
- [ ] Manipulierte Quellen-IDs fremder Notebooks im Request → 403/404, keine Daten (Test).
- [ ] Session A sieht unter keiner Route Daten von Session B (Testmatrix grün).
- [ ] Verlauf inkl. anklickbarer Zitate ist nach Reload vollständig; Zitate gelöschter Quellen sind als solche markiert und crashen nichts.

## M5: Zusammenfassung (Studio)

Umfang:

- Zusammenfassung gemäß Architektur 5.5: kurze Dokumente in einem Aufruf, längere mit begrenzter mehrstufiger Verarbeitung (hartes Batch-Maximum, sichtbarer Hinweis bei Auslassung). Strukturiertes Ergebnis mit validierten Zitaten, SSE-Streaming, Speicherung im Verlauf. Keine Vollständigkeits- oder Richtigkeitsgarantie; die UI deklariert das.

Akzeptanzkriterien:

- [ ] Zusammenfassung über 2+ Quellen referenziert jede ausgewählte Quelle oder nennt sie explizit als "ohne relevanten Inhalt" (Test mit Fixtures).
- [ ] Kurzes Dokumentset → genau ein Modellaufruf; langes Dokument → Batches bis zum Maximum, darüber sichtbarer Auslassungshinweis (Unit-Tests der Batch-Planung).
- [ ] Batch-Bildung respektiert das Token-Budget (Unit-Test); Zitate durchlaufen dieselbe Validierung wie im Chat.

## M6: Betriebsschutz (Limits, Kill-Switch, Injection-Härtung)

Umfang:

- DB-basierte Rate-Limits: Login pro IP, Uploads pro Session, Modellaufrufe pro Session; Konstanten zentral in `limits.ts`.
- Kontext-Token-Budget und `max_output_tokens` erzwungen.
- `AI_FEATURES_ENABLED`-Kill-Switch (503 mit klarer Meldung; Verarbeitung stoppt vor Embedding).
- Sichere Darstellung final: Markdown-Rendering ohne Raw-HTML, Injection-Fixtures (Dokumente mit Anweisungen, HTML, Script, gefälschten Zitatformaten) durch Verarbeitung, Chat und Rendering geführt.

Akzeptanzkriterien:

- [ ] Jedes Limit greift serverseitig und überlebt einen Prozess-Neustart (Tests gegen die DB).
- [ ] Kill-Switch: Chat/Zusammenfassung/Verarbeitung antworten definiert; Verwaltung und Anzeige funktionieren weiter (Test).
- [ ] Injection-Fixtures: kein HTML/Script wird gerendert, gefälschte Zitatmarker werden entfernt, Dateimetadaten bleiben DB-basiert (deterministische Tests; Modellverhalten selbst wird in M7-Eval gemessen).
- [ ] 11. schneller Login-Fehlversuch wird abgelehnt (Test).

## M7: Testabschluss und Live-Evaluation

Umfang:

- Lücken der deterministischen Suite schließen; Playwright-Durchstich auf finale UI aktualisiert; CI-fähiger Testlauf (alles gegen Mock).
- `scripts/eval`: Datenset (beantwortbar, unbeantwortbar, quellenübergreifend, Injection, Quellenwechsel im Verlauf: zuvor beantwortete Frage erneut stellen, nachdem die einzige belegende Quelle abgewählt wurde; erwartet wird eine Ablehnung statt unbelegter Übernahme aus dem Verlauf), getrennte Metriken für Retrieval (Hit-Rate der erwarteten Chunks) und Antwortqualität (belegt, korrekt zitiert, Ablehnung, Injection-Resistenz), Markdown-Report.

Akzeptanzkriterien:

- [ ] Kompletter Vitest- und Playwright-Lauf grün, ohne Netzwerkzugriff auf OpenAI.
- [ ] Live-Eval läuft mit dem konfigurierten Modell durch und erzeugt einen Report mit beiden Metrik-Blöcken; Ergebnisse (auch schlechte) werden unverändert in `docs/ai-usage.md` festgehalten.

## M8: Reviews durch Agents und Korrekturen

Ablauf (sequenziell bzw. auf disjunkten Dateien, nie gleichzeitig dieselben Dateien):

1. **Test Engineer:** prüft Testabdeckung, Fixture-Qualität, Determinismus; nur Befundbericht, keine Änderungen am Produktionscode.
2. **RAG Reviewer:** prüft Chunking, Retrieval-Scoping, Prompt, Zitatvalidierung, Zusammenfassungs-Abdeckung; nur Befundbericht.
3. **Security Reviewer:** prüft Auth, IDOR, Limits, Upload-Validierung, Rendering, Secret-Handling; nur Befundbericht.
4. **Hauptagent:** bewertet Befunde (belegt vs. spekulativ), nimmt gezielte Korrekturen vor, führt die volle Regressionssuite aus.

Akzeptanzkriterien:

- [ ] Drei schriftliche Review-Berichte liegen vor (`docs/reviews/`).
- [ ] Jeder Befund ist als behoben, abgelehnt (mit Begründung) oder bekannte Einschränkung dokumentiert.
- [ ] Regressionssuite nach den Korrekturen grün.

## M9: Repository und Deployment (erst nach expliziter Freigabe)

Umfang:

- Öffentliches GitHub-Repository (ohne Secrets, `.env.example` mit allen Variablen).
- Multi-Stage-Dockerfile (standalone, non-root), Compose mit Healthcheck (`/api/health`) und `restart: unless-stopped`.
- Deployment auf 45.137.68.43: Nginx-Vhost Port 80, Cloudflare-Subdomain `llm.truenasserver.com` (proxied), bestehende Dienste und DNS unangetastet.
- Supabase-Produktionsprojekt, Migrationen eingespielt, Live-Smoke-Test (Durchstich von Hand).

Akzeptanzkriterien:

- [ ] `docker compose up -d` auf dem Server; Healthcheck healthy; Neustart-Verhalten verifiziert.
- [ ] Anwendung unter der HTTPS-Subdomain erreichbar; Login, Upload, Frage, Zitat funktionieren live.
- [ ] Kein Secret im Repository, in Logs oder in der Ausgabe (Kontrolle vor Push).
- [ ] Bestehende Vhosts/DNS-Einträge unverändert (Vorher/Nachher-Kontrolle).

## Reihenfolge und Abhängigkeiten

M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → (Freigabe) → M9. M5 und M6 sind untereinander tauschbar; alles andere baut aufeinander auf.

## Benötigte Umgebungsvariablen

`OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIMENSIONS`, `DEMO_PASSWORD`, `AUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_FEATURES_ENABLED`.

Stand 2026-10-01: Alle Variablen liegen in der lokalen `.env` vor (OpenAI- und Supabase-Zugang), keine Blocker für M1/M2.
