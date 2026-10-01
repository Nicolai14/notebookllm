# Auftrag: Live-Prüfung, M3 und M4 (2026-10-01)

Nachfolgend der dritte Auftrag im Wortlaut. Er enthält keine Secrets.

---

Das OpenAI-Guthaben ist jetzt aufgeladen. Hole die echte OpenAI-Prüfung nach und setze anschließend M3 und M4 um.

Die Modellwahl ist festgelegt. Verwende folgende Werte ausschließlich über die ENV:

- OPENAI_CHAT_MODEL=gpt-6.1-sol
- OPENAI_EMBEDDING_MODEL=text-embedding-3-small
- OPENAI_EMBEDDING_DIMENSIONS=1536

Keine fest eingebauten Modellnamen, Modell-Defaults oder automatischen Ersatzmodelle.

Setze den Reasoning-Aufwand für das Chat-Modell zunächst auf low. Passe die Parameter an den vorhandenen API-Endpunkt an und entferne für dieses Modell nicht unterstützte Parameter. Behalte die vorhandene Streaming-Implementierung bei.

Prüfe die Übereinstimmung von Embedding-Modell, Dimension, Datenbankschema und embedding_config. Falls bereits Embeddings mit einer anderen Konfiguration existieren, verwende eine kontrollierte Re-Indexierung. Ändere nicht einfach den Konfigurationseintrag, während alte Vektoren bestehen bleiben.

Arbeite anschließend diese Schritte ab:

1. Echter M2-Durchlauf:
   Lade ein kleines TXT-Dokument hoch, erstelle echte Embeddings und stelle eine beantwortbare Frage. Prüfe die gestreamte Antwort, das anklickbare Zitat und ob die Originalpassage die Aussage tatsächlich belegt. Teste außerdem eine Frage, deren Antwort nicht im Dokument steht.

2. Supabase-Sicherheit:
   Prüfe den Status der Sicherheitsmeldungen zu RLS, exponierten sensiblen Spalten, vector im public-Schema und dem search_path von match_chunks. Behebe offene kritische Befunde als versionierte Migration. Prüfe, dass direkte unberechtigte Zugriffe blockiert sind und der autorisierte App-Zugriff weiterhin funktioniert.

3. M3:
   Implementiere PDF- und Markdown-Verarbeitung sowie die Datei-Ansicht gemäß Plan. Prüfe bei PDFs Seitenzuordnung und anklickbare Belege. Zeige bei PDFs ohne extrahierbaren Text eine verständliche Meldung. OCR gehört nicht zum Umfang.

4. M4:
   Implementiere die Quellenauswahl im Chat. Nur ausgewählte, fertig verarbeitete Quellen dürfen für die Antwort verwendet werden. Eine leere Auswahl darf nicht automatisch alle Quellen einschließen.

Teste die neuen Funktionen und führe einen kleinen echten Durchlauf mit zwei Quellen durch, bei dem die Quellenauswahl das Retrieval nachvollziehbar einschränkt.

Dokumentiere diesen Prompt, die Modellentscheidung und tatsächlich ausgeführte Prüfungen. Unterscheide weiterhin Tests mit Mocks von echten OpenAI-Aufrufen. Der erfolgreiche Durchlauf ersetzt nicht die spätere Live-Evaluation aus M7.

Arbeite mit kleinen Commits. Stoppe nach M4 mit einem kurzen Bericht über Funktionen, Prüfungen und offene Punkte. Noch kein öffentliches Deployment.
