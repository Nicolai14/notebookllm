# Initialer Auftrag (2026-09-30)

Nachfolgend der initiale Projektauftrag im Wortlaut. Er enthält keine Secrets.

---

Plane einen fokussierten NotebookLM-Klon als hochwertige Desktop-Webanwendung. Erstelle zunächst die Architektur und einen überschaubaren Implementierungsplan. Implementiere noch keinen Anwendungscode.

## Ziel und Umfang

Nutzer sollen Dokumente hochladen und Fragen anhand dieser Quellen stellen können.

Der MVP umfasst:

- Notebooks erstellen, öffnen und löschen.
- PDF, TXT und Markdown hochladen, anzeigen und löschen.
- Quellen für den Chat auswählen und abwählen.
- Verarbeitungsstatus und verständliche Fehlermeldungen anzeigen.
- Chat mit Streaming-Antworten und gespeichertem Verlauf.
- Anklickbare Quellenangaben mit Dokument, Seite beziehungsweise Abschnitt und Textpassage.
- Strukturierte Zusammenfassung der ausgewählten Quellen.

Die Desktop-Oberfläche orientiert sich konzeptionell an NotebookLM mit den Bereichen Sources, Chat und Studio, verwendet aber eigenes Branding.

Keine mobile Optimierung, Benutzerregistrierung, Zusammenarbeit, Audioübersichten oder weiteren Studio-Funktionen.

## Technischer Rahmen

Verwende Next.js, TypeScript, Tailwind CSS und shadcn/ui sowie Supabase PostgreSQL mit pgvector und Supabase Storage. Für Tests verwenden wir Vitest und Playwright.

OpenAI wird für Antwortgenerierung und Embeddings verwendet. Ich lege die Modelle und Embedding-Dimension selbst über folgende Umgebungsvariablen fest:

- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `OPENAI_EMBEDDING_DIMENSIONS`

Wähle keine Modelle selbstständig und hinterlege keine Modellnamen als Defaults im Code. Plane eine Validierung der Konfiguration und der Übereinstimmung mit dem Datenbankschema. Ein Wechsel des Embedding-Modells darf vorhandene Vektoren nicht unbemerkt inkompatibel machen.

Halte die Architektur einfach. Führe zusätzliche Frameworks oder Dienste nur mit einer konkreten Begründung ein.

## RAG und Quellenqualität

Plane den Ablauf:

Dokument extrahieren → in Chunks zerlegen → Embeddings speichern → relevante Chunks zur Frage suchen → Antwort aus diesem Kontext generieren.

Schlage eine einfache Chunking-Strategie vor und erkläre die Kompromisse bei Größe, Überlappung und Erhaltung der Dokumentstruktur. Seiten- beziehungsweise Abschnittsangaben müssen beim Verarbeiten erhalten bleiben.

Die Suche muss auf das aktuelle Notebook und die ausgewählten Quellen eingeschränkt sein.

Das Modell erhält eindeutige Referenzen auf die gefundenen Chunks. Quellenangaben werden serverseitig gegen diese Referenzen validiert. Dokumentnamen und Seitenangaben stammen aus gespeicherten Metadaten, nicht aus frei erzeugten Modellangaben.

Unterscheide zwischen einer gültigen Quellenreferenz und einer tatsächlich durch die Quelle belegten Aussage. Bei fehlender Quellenbasis soll die Anwendung die Frage nicht aus allgemeinem Modellwissen beantworten.

Für Zusammenfassungen muss die Strategie die ausgewählten Inhalte ausreichend abdecken; eine normale Top-K-Suche zu einer einzelnen Frage genügt dafür nicht.

## Zugang und Betriebsschutz

Die Webdemo erhält einen einfachen serverseitigen Passwortschutz mit `DEMO_PASSWORD` und `AUTH_SECRET`, sicherem HttpOnly-Session-Cookie und Logout.

Jede Sitzung besitzt getrennte Notebooks und Dateien. Autorisierung muss für sämtliche Datenzugriffe und API-Endpunkte gelten. Beschreibe das tatsächliche Schutzmodell, insbesondere beim Einsatz eines Supabase-Service-Role-Keys.

Plane außerdem:

- maximal 5 MB pro Datei und 10 Quellen pro Notebook,
- Begrenzung der extrahierten Textmenge,
- dauerhafte serverseitige Limits für Login, Uploads und Modellaufrufe,
- begrenzten Kontext und Antwortumfang,
- `AI_FEATURES_ENABLED` als Kill-Switch,
- private Quelldateien und vollständiges Löschen zugehöriger Daten,
- Upload-Validierung und sichere Darstellung von Dokument- und Modelltexten.

Behandle Dokumentinhalte als unvertrauenswürdige Daten. Plane Maßnahmen und Testfälle gegen Prompt Injection, ohne vollständigen Schutz zu behaupten.

## Qualität und Agents

Plane deterministische Tests für Dokumentverarbeitung, Retrieval-Anbindung, Zitatvalidierung, Zugriffsschutz, Limits und Löschung sowie einen zentralen Playwright-Test vom Upload bis zur Antwort mit Quellenanzeige.

Trenne diese Tests von einer kleinen Live-Evaluation mit dem konfigurierten OpenAI-Modell. Die Evaluation soll beantwortbare und unbeantwortbare Fragen, mehrere Quellen und Prompt-Injection-Inhalte enthalten. Bewerte Retrieval und Antwortqualität getrennt.

Plane nach der Implementierung getrennte Reviews durch:

- Test Engineer,
- RAG Reviewer,
- Security Reviewer.

Diese Agents prüfen zunächst ohne Änderungen am Produktionscode. Der Hauptagent bewertet belegte Befunde, nimmt gezielte Korrekturen vor und führt Regressionstests aus. Mehrere Agents dürfen nicht gleichzeitig dieselben Dateien bearbeiten.

## Repository und Deployment

Die Serverumgebung ist für Docker, GitHub und Cloudflare vorbereitet. Nutze vorhandene Werkzeuge, Konfigurationen und Credentials selbstständig.

Nach meiner Freigabe sollst du ein neues öffentliches GitHub-Repository erstellen und die Anwendung über Docker Compose und eine passende freie Cloudflare-Subdomain bereitstellen.

Plane einen produktiven Next.js-Container mit Healthcheck, Neustartregel und HTTPS. Bestehende Dienste und DNS-Einträge dürfen nicht beeinträchtigt werden.

Secrets dürfen niemals ausgegeben, protokolliert oder committed werden. Fehlende Zugänge oder notwendige Angaben meldest du konkret als Blocker.

## Ergebnis dieses ersten Durchlaufs

Erstelle:

- `docs/architecture.md`: Architektur, Datenmodell, RAG-Ablauf und wesentliche Entscheidungen.
- `docs/implementation-plan.md`: kleine Meilensteine mit Akzeptanzkriterien, beginnend mit Upload → Frage → Antwort → anklickbare Quelle.
- `docs/ai-usage.md`: wichtige Prompts, Vorschläge, meine Entscheidungen und tatsächlich erfolgte Prüfungen klar getrennt.
- `docs/prompts/01-project-brief.md`: dieser initiale Auftrag ohne Secrets.

Begründe die wichtigsten Entscheidungen knapp und verständlich. Liste offene Fragen, benötigte Umgebungsvariablen und bewusste Einschränkungen auf.

Stoppe anschließend und warte auf meine Prüfung und Freigabe. Erstelle noch kein externes Repository, ändere keine Infrastruktur und starte noch keine Implementierung oder Bereitstellung.
