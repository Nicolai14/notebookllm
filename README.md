# Fundus

Ein fokussierter NotebookLM-Klon als Desktop-Webanwendung: Dokumente hochladen, Fragen zu diesen Quellen stellen, Antworten mit anklickbaren, serverseitig validierten Quellenangaben erhalten, Quellen auswählen und strukturierte Zusammenfassungen erstellen.

**Live-Demo:** https://llm.truenasserver.com (Zugang mit dem Demo-Passwort; es wird nicht im Repository hinterlegt). Jede Anmeldung erhält eine eigene Sitzung mit getrennten Notebooks und Dateien; der Logout löscht die Daten der Sitzung.

## Stack

Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui-Komponentenstil, Supabase (PostgreSQL + pgvector, Storage), OpenAI (Modelle ausschließlich per Umgebungsvariablen), Vitest, Playwright, Docker Compose, Nginx + Cloudflare (Full strict).

## Einrichtung (lokal)

1. `.env` nach dem Muster von `.env.example` anlegen. Alle Pflichtvariablen müssen gesetzt sein; die Anwendung startet nicht mit unvollständiger Konfiguration.
2. Abhängigkeiten installieren und Schema anwenden:

   ```bash
   npm install
   npm run db:apply   # Migrationen + privater Storage-Bucket + embedding_config
   ```

3. Entwicklung bzw. Produktion:

   ```bash
   npm run dev        # http://localhost:3000
   npm run build && npm start
   ```

## Konfiguration

Alle Variablen sind in `.env.example` dokumentiert und in `docs/architecture.md` (Abschnitt 2) erläutert. Kernpunkte:

- Modelle und Embedding-Dimension kommen ausschließlich aus der ENV; es gibt keine Defaults im Code. Ein Wechsel des Embedding-Modells wird gegen `embedding_config` geprüft und blockiert KI-Endpunkte, bis bewusst re-indexiert wird.
- `AI_FEATURES_ENABLED=false` schaltet Chat, Zusammenfassung und Verarbeitung ab; Verwaltung bleibt nutzbar.
- `CLIENT_IP_HEADER` (Produktion: `cf-connecting-ip`) bestimmt die Client-IP für Login-Limits; ohne gesicherte Proxy-Kette nicht setzen.
- Ein Produktionsstart mit `COOKIE_SECURE=false` wird verweigert; der Override existiert nur für lokale Testläufe zusammen mit `ALLOW_INSECURE_TEST_COOKIES=true`.

## Tests und Prüfungen

| Befehl | Inhalt | OpenAI |
|---|---|---|
| `npm run typecheck` | TypeScript | keine Aufrufe |
| `npm run test:unit` | Chunking, Zitatvalidierung, Zusammenfassungsplanung, Session-Cookie, Konfiguration, Verarbeitungslimits | keine Aufrufe |
| `npm run test:integration` | Session-Trennung, Vektor-Scoping, Löschkaskaden, atomare Rate-Limits; läuft gegen die konfigurierte Supabase-DB | keine Aufrufe (Fake-Embeddings) |
| `npm run test:e2e` | Build + Browser-Durchstich, Zugriffsschutz, Limits, Kill-Switch, Fehlerinjektion | lokaler Mock (`tests/mocks/openai-mock.mjs`) |
| `npm run eval` | Live-Evaluation (19 Fälle) gegen das echte Modell, Report nach `docs/eval/` | echte Aufrufe |

CI (GitHub Actions, `.github/workflows/ci.yml`): Typecheck, Unit-Tests, Build. Integrations-/E2E-Tests und die Live-Evaluation laufen bewusst nicht in CI (benötigen isolierte Umgebung bzw. echte OpenAI-Aufrufe); kein ESLint, da keine Lint-Konfiguration existiert. Finale Evaluationsergebnisse: 19/19 (`docs/eval/report-2026-10-01-1407.md`); Prüfmethoden darin als "auto" bzw. "ai-reviewer" (Selbstbewertung durch das konfigurierte Modell) gekennzeichnet.

## Betrieb (Deployment)

Produktion läuft auf dem Server als Docker-Compose-Dienst in `/repos/notebookllm` (Container nur auf `127.0.0.1:3010`, Nginx-Vhost `llm.truenasserver.com` mit Let's-Encrypt-Zertifikat, Cloudflare Full (strict), Zugriff ausschließlich über den Cloudflare-Proxy).

Update auf den neuesten Stand:

```bash
ssh root@45.137.68.43
cd /repos/notebookllm
git pull
docker compose up -d --build
docker compose ps   # Status: healthy
```

Rollback auf einen früheren Commit:

```bash
cd /repos/notebookllm
git checkout <commit>
docker compose up -d --build
```

Logs und Neustart:

```bash
docker compose logs -f --tail 100
docker compose restart
```

Das Zertifikat erneuert acme.sh automatisch (Cron, `--reloadcmd 'systemctl reload nginx'`). Datenbankmigrationen werden bei Schemaänderungen einmalig per `npm run db:apply` (lokal, mit `SUPABASE_ACCESS_TOKEN`) eingespielt.

## Wichtige Eigenschaften

- **Zitate:** Das Modell erhält nummerierte Chunk-Auszüge; `[n]`-Marker werden serverseitig gegen genau diese Auszüge validiert, ungültige entfernt. Dateiname und Fundstelle (PDF-Seite, Markdown-Abschnitt) stammen immer aus der Datenbank; die Originalpassage ist per Klick prüfbar.
- **Keine Antwort ohne Quellenbasis:** Ohne ausreichende Treffer antwortet die Anwendung mit einem festen Hinweis statt aus Modellwissen; der Gesprächsverlauf dient nur der Einordnung, nie als Beleg.
- **Quellenauswahl ist Pflicht:** Eine leere Auswahl bedeutet nie "alle Quellen".
- **Zusammenfassungen** decken den gesamten Text der Auswahl ab (direkt oder begrenzt mehrstufig); Auslassungen werden deterministisch ausgewiesen. Keine Garantie für Vollständigkeit oder Richtigkeit.
- **Betriebsschutz:** Datei- und Quellen-Limits, Verarbeitungslimits mit Timeout, dauerhafte atomare Rate-Limits (Login pro IP, KI-Aktionen und Uploads pro Session plus globale Backstops), Kill-Switch, serverseitige Logout-Invalidierung.

## Bekannte Einschränkungen

Siehe `docs/architecture.md` Abschnitt 11, u. a.: ein gemeinsames Demo-Passwort (Sessions sind Datentrennung, keine Mandantensicherheit), reine Vektorsuche ohne Hybrid-Retrieval, Zitatvalidierung garantiert Referenz-Gültigkeit statt Belegtreue (per Evaluation gemessen), kein OCR für gescannte PDFs, Token-Zählung per Schätzung, keine mobile Optimierung, Erreichbarkeit nur über den Cloudflare-Proxy.

## Dokumentation

- `docs/architecture.md`: Architektur, Datenmodell, RAG-Ablauf, Schutzmodell
- `docs/implementation-plan.md`: Meilensteine mit Akzeptanzkriterien
- `docs/ai-usage.md`: Prompts, Entscheidungen, tatsächlich ausgeführte Prüfungen (Mock vs. echt)
- `docs/eval/`: Live-Evaluationsläufe (Datenset: `scripts/eval/`)
- `docs/reviews/`: Review-Berichte (Test, RAG, Security) und Befund-Bewertung
- `docs/prompts/`: die Projektaufträge im Wortlaut
