# Review Test Engineer (Datum 2026-10-01)

Erstellt durch einen separaten Review-Agenten (nur lesend, eigener Kontext). Bewertung und Umsetzung der Befunde: siehe docs/reviews/findings-resolution.md.

## Zusammenfassung (3-5 Sätze)

Die Testbasis ist für ein Demo-Projekt überdurchschnittlich: Unit-Tests prüfen echte Randfälle (Zitatvalidierung, Chunking-Overlap, Session-Cookies), Integrationstests weisen Scoping und Rate-Limit-Atomarität nebenläufig nach, und der OpenAI-Mock emittiert absichtlich ungültige Marker, sodass die Zitatvalidierung end-to-end real geprüft wird statt vorweggenommen. Die größte Lücke ist die vollständige Abwesenheit von Fehlerinjektion: Der Mock kann nie fehlschlagen, daher sind alle KI-Dienst-Fehlerpfade (SSE-error-Event, 503-Mapping, fehlgeschlagene Embeddings beim Upload) sowie SSE-Client-Abbrüche und der Verarbeitungs-Timeout ungetestet. Exitcode-Weitergabe ist in allen Skripten korrekt (keine Pipes, `&&`-Ketten, `process.exit(1)` im Eval-Runner), es existiert jedoch keine CI-Pipeline, obwohl der Implementierungsplan einen "CI-fähigen Testlauf" nennt. Flakiness-Risiken sind begrenzt (workers=1), konzentrieren sich aber auf die geteilte, dauerhafte Supabase-DB und den Login-Rate-Limit-Key `login:unknown`.

## Befunde

### [SCHWEREGRAD: hoch] KI-Dienst-Fehlerpfade komplett ungetestet, Mock kennt keine Fehlerinjektion
- Stelle: tests/mocks/openai-mock.mjs:1-146; src/app/api/notebooks/[id]/chat/route.ts:139-163 (error-Event); src/lib/openai.ts (`toAiServiceError`); src/lib/processing/process.ts:33-43 (Upload-Fehlerstatus bei Embedding-Fehler)
- Nachweis: Der Mock hat nur `/__stats` und `/__reset`, keinen Endpunkt, der 429/500/Timeout/abgebrochene Streams simuliert. Dadurch ist nirgends geprüft: (a) dass ein OpenAI-Fehler mitten im Stream als SSE-`error`-Event mit deutscher Meldung ankommt, (b) dass `toAiServiceError` 503 mit "KI-Dienst ist derzeit nicht verfügbar" liefert, (c) dass ein Upload bei fehlgeschlagenem Embedding in `status: "error"` mit sinnvoller `error_message` endet (getestet ist nur der Kill-Switch- und der OCR-Fall). Kein einziger Test parst ein `error`-Event; `finalMessage()` in selection/summary.spec wirft lediglich darauf.
- Lösungsvorschlag: Mock um einen Steuerendpunkt erweitern (z. B. `POST /__fail {mode:"chat"|"embeddings", status:500, afterChunks:1}`) und drei E2E-Tests ergänzen: Upload mit Embedding-Fehler → `status:"error"`; Chat mit Sofort-Fehler → `error`-Event; Chat mit Fehler nach erstem Delta → `error`-Event und kein persistiertes Assistant-Fragment.

### [SCHWEREGRAD: hoch] SSE-Client-Abbruch ungetestet; Fehlerpfad im Stream kann selbst werfen
- Stelle: src/app/api/notebooks/[id]/chat/route.ts:97-163 und src/app/api/notebooks/[id]/summary/route.ts (identisches Muster); kein Test in tests/e2e/
- Nachweis: Die `ReadableStream`s haben keinen `cancel()`-Handler. Bricht der Client die Verbindung ab, wirft `controller.enqueue(...)` in `send()`; der `catch`-Block ruft erneut `send({type:"error",...})` auf, was auf dem abgebrochenen Stream erneut wirft und als unbehandelte Rejection aus `start()` entweicht. Zusätzlich liefe der OpenAI-Stream ungebremst weiter (Kosten). Kein Test simuliert einen Abbruch.
- Lösungsvorschlag: E2E-Test, der die Chat-Anfrage nach dem ersten Delta abbricht und danach prüft, dass der Server weiterhin antwortet und kein halbfertiges Assistant-Fragment persistiert wurde. Im Code: `send` abbruchsicher machen (try/catch um enqueue) und `cancel()` implementieren.

### [SCHWEREGRAD: mittel] Verarbeitungs-Timeout ungetestet; `withTimeout` bricht die Pipeline nicht ab (Nebenläufigkeits-Race)
- Stelle: src/lib/processing/process.ts:22, 103-121 (`Promise.race`), 86-99 (`insertChunks`)
- Nachweis: Kein Test erzwingt `MAX_PROCESSING_MS` (60 s). `withTimeout` nutzt `Promise.race`, die verlierende `runPipeline`-Promise läuft weiter: Nach `updateSourceStatus(source.id, "error", ...)` kann die noch laufende Pipeline `insertChunks` ausführen — verwaiste Chunks zu einer Quelle im Status `error` (Chat filtert nur auf `status === "ready"`, aber die Daten liegen in der DB). Weder das Timeout-Verhalten noch dieses Race ist abgedeckt.
- Lösungsvorschlag: Unit-Test für `processSource` mit injizierter langsamer Pipeline, Assertions: Status `error` mit Timeout-Meldung und keine Chunks nach Abschluss der verspäteten Pipeline. Im Code ein `AbortSignal` durchreichen.

### [SCHWEREGRAD: mittel] Keine CI-Pipeline trotz korrekt propagierender Exitcodes
- Stelle: Repo-Wurzel (kein `.github/`); docs/implementation-plan.md ("CI-fähiger Testlauf")
- Nachweis: Die Skripte selbst sind CI-tauglich (`&&`-Ketten propagieren, Vitest/Playwright geben non-zero zurück, Eval-Runner endet mit `process.exit(1)` bei Fehlschlägen), aber nichts erzwingt ihre Ausführung vor einem Merge/Deploy. Integrationstests und E2E benötigen zudem eine echte Supabase-Instanz via `.env`.
- Lösungsvorschlag: Minimaler GitHub-Actions-Workflow: `typecheck` + `test:unit` immer; `test:integration`/`test:e2e` mit Secrets gegen eine dedizierte Test-DB. `scripts/eval` bewusst ausklammern.

### [SCHWEREGRAD: mittel] Grenzwerte ungetestet: Upload-Rate-Limit, Fragelänge, Extraktionslimit
- Stelle: src/lib/limits.ts (RATE_LIMIT_UPLOAD, MAX_QUESTION_CHARS, MAX_EXTRACTED_TOKENS); keine Treffer in tests/
- Nachweis: `upload:${sessionId}` wird in keinem Test ausgelöst oder vorgeseedet (ratelimit.spec deckt nur `ai:` und `login:` ab). Eine Frage > 2000 Zeichen und ein Dokument > 120.000 Tokens sind nie geprüft — die deutschen Fehlermeldungen dieser Pfade sind unverifiziert.
- Lösungsvorschlag: Analog zum AI-Limit den `upload:`-Zähler seeden und 429 + Meldung asserten; ein API-Test mit 2001-Zeichen-Frage (400) und ein Unit-Test für das Extraktionslimit.

### [SCHWEREGRAD: mittel] TOCTOU beim 10-Quellen-Limit: Nebenläufigkeit ungetestet
- Stelle: src/app/api/notebooks/[id]/sources/route.ts:76-80
- Nachweis: `if ((await countSources(notebook.id)) >= MAX_SOURCES_PER_NOTEBOOK)` ist check-then-act ohne DB-Constraint: Zwei parallele Uploads bei 9 vorhandenen Quellen können beide passieren (11 Quellen). Der E2E-Test lädt strikt sequenziell und kann das Race nicht erkennen.
- Lösungsvorschlag: Test mit zwei parallelen Uploads bei 9 Quellen; serverseitig per DB-Constraint oder Zählung in einer Transaktion absichern.

### [SCHWEREGRAD: mittel] selection.spec: Kern-Assertion kann leer durchlaufen (trivially-pass)
- Stelle: tests/e2e/selection.spec.ts:68-71
- Nachweis: `for (const citation of restricted.citations) { ... }` — liefert das Retrieval nichts (Refusal-Pfad, `citations: []`), läuft die Schleife nie und der Test besteht, ohne die Eigenschaft je geprüft zu haben. In summary.spec ist dasselbe Muster korrekt mit `length > 0` abgesichert.
- Lösungsvorschlag: Vor der Schleife `expect(restricted.citations.length).toBeGreaterThan(0)` oder explizit den alternativen Refusal-Ausgang asserten.

### [SCHWEREGRAD: mittel] Eval-Checks mit `.every()` auf leeren Zitatlisten; Judge wird bei 0 Zitaten still übersprungen
- Stelle: scripts/eval/run.mjs (`citationsSubsetOfSelection`, `validRefs`, `judgeFaithfulness && citations.length > 0`); dataset.mjs Fall "12-injektion-regeln"
- Nachweis: `message.citations.every(...)` ist auf leerer Liste wahr. Fall 12 hat `judgeFaithfulness: true`, aber keine Zitat-Pflicht: Antwortet das Modell mit passenden Uhrzeiten ohne ein einziges Zitat, wird der Judge übersprungen und der Fall besteht als PASS — die Eigenschaft "belegt" wurde dann nie bewertet.
- Lösungsvorschlag: Für Nicht-Refusal-Fälle einen Auto-Check "mindestens ein Zitat" ergänzen bzw. den Judge-Skip als FAIL ausweisen.

### [SCHWEREGRAD: mittel] Geteilte, dauerhafte Rate-Limit-Keys (`login:unknown`) und gemeinsame DB als Flakiness-Quelle
- Stelle: src/app/api/auth/login/route.ts (`|| "unknown"`); tests/e2e/security.spec.ts ("falsches Passwort", ohne Cleanup); playwright.config.ts (zwei App-Instanzen, eine DB)
- Nachweis: Ohne `x-forwarded-for` landen alle lokalen Logins auf dem persistenten Key `login:unknown`. Der Fehlversuch im Security-Test wird nie zurückgesetzt; wiederholtes Ausführen des Einzeltests (>10× in 15 min) liefert 429 statt 401 — der Test schlägt ohne Codeänderung fehl.
- Lösungsvorschlag: Im Test "falsches Passwort" eine eindeutige `x-forwarded-for` setzen und den Key löschen; mittelfristig dedizierte Test-DB.

### [SCHWEREGRAD: niedrig] Staged-Summary-Test belegt nicht, dass der mehrstufige Pfad lief
- Stelle: tests/e2e/summary.spec.ts:108-148
- Nachweis: Der Test assertet nur Zitate und Passagen — Eigenschaften, die der direkte Pfad genauso erfüllt. Würde `planSummary` fälschlich immer `mode: "direct"` liefern, bestünde der Test weiter. `/__stats` (`stats.chat`) könnte die Zahl der Chat-Aufrufe (> 1) belegen.
- Lösungsvorschlag: Vor dem Summary-Aufruf `POST /__reset`, danach `expect(stats.chat).toBeGreaterThan(1)`.

### [SCHWEREGRAD: niedrig] Zitatvalidierung: Marker mit ≥5 Ziffern bleiben als Text stehen — ungetesteter Randfall
- Stelle: src/lib/rag/citations.ts (`/\[(\d{1,4})\]/g`); tests/unit/citations.test.ts (testet nur bis `[99]`)
- Nachweis: Ein erzeugtes `[12345]` matcht die Regex nicht, wird weder validiert noch entfernt und erscheint als scheinbarer Beleg im Antworttext — entgegen dem dokumentierten Anspruch. Auch `[01]` (führende Null) erzeugt eine Citation mit `marker: 1`, während der Text `[01]` zeigt; das Chip-Mapping ist ungetestet.
- Lösungsvorschlag: Zwei Unit-Fälle ergänzen (`[12345]`, `[01]`) und die Regex-Obergrenze entfernen bzw. führende Nullen normalisieren.

### [SCHWEREGRAD: niedrig] Eval-Runner: Setup-Fehler verwerfen alle Ergebnisse; Datum hartkodiert
- Stelle: scripts/eval/run.mjs (`const DATE = "2026-10-01"`; Upload/`createNotebook` außerhalb des Fall-try; Report-Schreiben nach try/finally)
- Nachweis: Wirft `uploadDocument`/`createNotebook`, verlässt die Exception die gesamte Schleife; Report und JSON werden nie geschrieben — bereits bestandene Fälle sind verloren. `DATE` ist fix: Jeder spätere Lauf überschreibt den Report mit falschem Datum. Unverifiziert: ob `server.kill()` den `next start`-Kindprozess des npx-Wrappers mitbeendet.
- Lösungsvorschlag: Upload/Notebook-Anlage in das Fall-try ziehen, `DATE` aus `new Date()` ableiten, Server in eigener Prozessgruppe beenden.

### [SCHWEREGRAD: niedrig] Verwaiste User-Message bei fehlgeschlagener Antwort ungetestet
- Stelle: src/app/api/notebooks/[id]/chat/route.ts (insertMessage vor retrieveChunks)
- Nachweis: Schlägt das Frage-Embedding fehl, ist die User-Message bereits persistiert; der Verlauf enthält danach eine Frage ohne Antwort. Kein Test deckt diesen Zustand ab (hängt am Hoch-Befund fehlender Fehlerinjektion).
- Lösungsvorschlag: Nach Einführung der Mock-Fehlerinjektion die Message-Anzahl nach fehlgeschlagenem Chat asserten und das gewünschte Verhalten festschreiben.

## Positiv (kurz)

- Der OpenAI-Mock nimmt Assertions bewusst nicht vorweg: Er emittiert absichtlich ungültige Marker (`[9]`, `[77]`), sodass Happy-Path und Summary-E2E die serverseitige Zitatvalidierung wirklich beweisen.
- Kill-Switch- und Rate-Limit-Tests prüfen die stärkste Eigenschaft überhaupt: "kein OpenAI-Aufruf" via Mock-Zähler statt nur Statuscodes.
- Rate-Limit-Atomarität wird echt nebenläufig verifiziert (20 parallele Aufrufe, exakt 10 erlaubt).
- Scoping/IDOR doppelt abgesichert: auf DB-Zugriffsschicht und per HTTP (fremde Session, anonym, Datei-Proxy).
- Fehlerpfad-Assertions prüfen überwiegend Status und deutschen Meldungstext gemeinsam.
- Exitcode-Hygiene: keine Shell-Pipes, `&&`-Ketten in package.json, `retries: 0`/`workers: 1` in Playwright, `process.exit(1)` bei Eval-Fehlschlägen; der Eval-Report kennzeichnet "ai-reviewer"-Checks transparent.
