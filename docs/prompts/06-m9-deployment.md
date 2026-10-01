# Auftrag: M9, Deployment und Abschluss (2026-10-01)

Nachfolgend der sechste Auftrag im Wortlaut. Er enthält keine Secrets.

---

M9 ist freigegeben. Stelle die Anwendung unter https://llm.truenasserver.com bereit und schließe das Projekt ab. Ergänze keine weiteren Produktfunktionen.

1. Finale Evaluation

Führe die vollständigen 19 Evaluationsfälle einmal mit dem finalen Code und der finalen Konfiguration aus. Bewahre die bisherigen Ergebnisse auf und dokumentiere den Abschlusslauf separat. Kennzeichne weiterhin automatische Prüfungen und die Selbstbewertung durch das AI-Judge-Modell.

2. Docker-Betrieb

Erstelle ein Dockerfile und eine Compose-Konfiguration für den Next.js-Standalone-Build, einschließlich der benötigten statischen Dateien.

Verwende einen Benutzer ohne Root-Rechte, eine Restart-Policy und einen einfachen Healthcheck. Geheimnisse gehören weder in das Image noch in den Build-Kontext; benötigte Server-Zugänge werden zur Laufzeit bereitgestellt.

3. Domain und Proxy

Nutze den vorhandenen Server und die vorhandene Proxy-Infrastruktur. Prüfe gezielt, ob truenasserver.com mit dem verfügbaren Cloudflare-Zugang verwaltet werden kann, und richte die Subdomain ein.

Beschränke DNS- und Proxy-Änderungen auf dieses Projekt. Falls der Domain-Zugang fehlt, erledige die übrigen Vorbereitungen und benenne konkret den fehlenden Zugriff. Verwende keine andere Domain ohne Abstimmung.

Sorge für HTTPS bis zum Origin: bei direktem Nginx-Betrieb Full (strict) mit gültigem Zertifikat oder eine passende bestehende Cloudflare-Tunnel-Lösung.

Der App-Port darf nur über den vorgesehenen Proxy erreichbar sein. Schütze den Origin-Zugang dieser Anwendung so, dass direkte Requests die vertrauenswürdigen IP-Header nicht vortäuschen können. Beschränke entsprechende Zugriffsregeln auf dieses Projekt.

4. Produktionskonfiguration

Setze COOKIE_SECURE=true und verhindere einen Produktionsstart mit deaktiviertem Secure-Flag.

Konfiguriere CLIENT_IP_HEADER=cf-connecting-ip passend zur tatsächlichen Proxy-Kette. Prüfe, dass Login-Limits die richtige Client-IP verwenden und gefälschte Header bei direkten Requests nicht akzeptiert werden.

Prüfe außerdem, dass Chat und Zusammenfassung durch den Proxy weiterhin tatsächlich streamen.

5. CI

Richte eine schlanke GitHub-Actions-Pipeline für Typecheck, vorhandene Lint-Prüfungen, Unit-Tests und Build ein. Fehler müssen zuverlässig zum Fehlschlagen der Pipeline führen.

Integrations- und Browser-Tests dürfen ausschließlich eine isolierte Testumgebung verwenden. Keine Tests gegen Produktionsdaten und keine echten OpenAI-Aufrufe in der Standard-CI. Dokumentiere den jeweiligen Prüfungsumfang.

6. Live-Prüfung und Dokumentation

Prüfe auf dem Deployment mit einer eigenen Testsession: Login, Upload, Frage, Streaming, anklickbarer Beleg, Quellenauswahl, Zusammenfassung und Logout. Prüfe außerdem den Zugriffsschutz und einen Container-Neustart.

Aktualisiere die README mit Live-URL, Einrichtung, Konfiguration, Prüfungen und bekannten Einschränkungen. Dokumentiere die Befehle für Updates und Rollback. Das Demo-Passwort bleibt außerhalb des öffentlichen Repositorys.

Halte diesen Prompt und die tatsächlich ausgeführten Arbeiten fest. Committe und pushe den finalen Stand.

Berichte abschließend die Live-URL, den deployten Commit, die erfolgreichen Prüfungen und gegebenenfalls verbleibende Blocker.
