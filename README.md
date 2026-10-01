# Fundus

Ein fokussierter NotebookLM-Klon als Desktop-Webanwendung: Dokumente hochladen, Fragen zu diesen Quellen stellen, Antworten mit anklickbaren, serverseitig validierten Quellenangaben erhalten.

Stand: Meilenstein M6 (PDF/TXT/Markdown-Upload mit Seiten- bzw. Abschnittszuordnung, Datei-Ansicht, Chat mit Streaming, validierten Zitaten und verpflichtender Quellenauswahl, strukturierte Zusammenfassungen im Studio, dauerhafte Rate-Limits, Kill-Switch). Live-Evaluation, Reviews und Deployment folgen gemäß `docs/implementation-plan.md`.

## Stack

Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui-Komponentenstil, Supabase (PostgreSQL + pgvector, Storage), OpenAI (Modelle ausschließlich per Umgebungsvariablen), Vitest, Playwright.

## Einrichtung

1. `.env` nach dem Muster von `.env.example` anlegen. Alle Variablen sind Pflicht; die Anwendung startet nicht mit unvollständiger Konfiguration.
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

Anmeldung mit dem `DEMO_PASSWORD`. Jede Anmeldung erhält eine eigene Session mit getrennten Notebooks und Dateien.

## Tests

| Befehl | Inhalt | OpenAI |
|---|---|---|
| `npm run test:unit` | Chunking, Zitatvalidierung, Session-Cookie, Konfiguration, Extraktion | keine Aufrufe |
| `npm run test:integration` | Session-Trennung (DAL), Vektor-Scoping, Löschkaskaden inkl. Storage; läuft gegen die konfigurierte Supabase-DB | keine Aufrufe (Fake-Embeddings) |
| `npm run test:e2e` | Build + kompletter Durchstich im Browser (Login → Upload → Frage → Antwort → Zitat → Passage) plus Zugriffsschutz- und Limit-Tests über die API | lokaler Mock (`tests/mocks/openai-mock.mjs`) |

Eine getrennte Live-Evaluation gegen das echte OpenAI-Modell ist für M7 geplant (`docs/architecture.md`, Abschnitt 8).

## Wichtige Eigenschaften

- **Zitate:** Das Modell erhält nummerierte Chunk-Auszüge; `[n]`-Marker werden serverseitig gegen genau diese Auszüge validiert, ungültige Marker werden entfernt. Dateiname und Fundstelle stammen immer aus der Datenbank.
- **Keine Antwort ohne Quellenbasis:** Ohne ausreichende Treffer antwortet die Anwendung mit einem festen Hinweis statt aus Modellwissen.
- **Verarbeitung im Request:** Extraktion, Chunking und Embeddings laufen vollständig im Upload-Request mit Limits (Dateigröße, extrahierte Tokens, Timeout) und enden deterministisch in `ready` oder `error`.
- **Schutzmodell:** Der Supabase-Service-Role-Key umgeht RLS; Autorisierung ist Anwendungslogik mit Session-Scope in jeder Query (Details und Grenzen in `docs/architecture.md`, Abschnitt 4).

## Dokumentation

- `docs/architecture.md`: Architektur, Datenmodell, RAG-Ablauf, Schutzmodell
- `docs/implementation-plan.md`: Meilensteine mit Akzeptanzkriterien
- `docs/ai-usage.md`: Prompts, Entscheidungen, tatsächlich ausgeführte Prüfungen
- `docs/prompts/`: ursprüngliche Aufträge
