# Review RAG (Datum 2026-10-01)

Erstellt durch einen separaten Review-Agenten (nur lesend, eigener Kontext). Bewertung und Umsetzung der Befunde: siehe docs/reviews/findings-resolution.md.

## Zusammenfassung (3-5 Sätze)

Die RAG-Pipeline ist insgesamt sauber gebaut: Retrieval ist durchgängig auf Notebook und session-validierte Quellenauswahl gescoped, Zitatmetadaten kommen ausschließlich aus der DB, der Leer-Treffer-Pfad antwortet ohne Modellaufruf, und Auslassungen bei Zusammenfassungen werden deterministisch serverseitig ausgewiesen. Der gravierendste Befund: Die Chunk-Reihenfolge für Zusammenfassungen sortiert nach `source_id` (zufällige UUIDv4), nicht nach Auswahl- oder Upload-Reihenfolge; dadurch ist bei gedeckelten Mehrquellen-Zusammenfassungen zufällig, welche Quelle vollständig ausgelassen wird, und Eval-Fall 15 ist nichtdeterministisch. Daneben gibt es mittlere Lücken: Die Reduce-Phase kann Marker innerhalb des gültigen Bereichs verschieben, ohne dass die Validierung es erkennt; der Faithfulness-Judge wird bei Antworten ohne Zitate übersprungen; der Summary-Judge sieht nur die ersten 6.000 Zeichen des Quelltexts; die History ist nur per Turn-Zahl, nicht per Token budgetiert. Die Evaluation ist überdurchschnittlich ehrlich aufgebaut (vorab fixiertes Dataset, auto vs. ai-reviewer gekennzeichnet), judged aber mit demselben Modell, das geprüft wird.

## Befunde

### [SCHWEREGRAD: hoch] Zusammenfassungs-Reihenfolge und Auslassungsziel hängen von zufälliger UUID-Sortierung ab; Eval-Fall 15 dadurch nichtdeterministisch
- Stelle: src/lib/db/chunks.ts:19 (`.order("source_id", { ascending: true })`), src/lib/rag/summary.ts:93-138, scripts/eval/dataset.mjs:295-302
- Nachweis: `listChunksBySources` sortiert nach `source_id`; `sources.id` ist `default gen_random_uuid()` (supabase/migrations/001_init.sql:22), also zufällige UUIDv4. `planSummary` iteriert `bySource.values()` in dieser Reihenfolge. Bei Fall 15 (4 lange Quellen, je ~5 benötigte Batches, `SUMMARY_MAX_BATCHES_PER_SOURCE=4`, `SUMMARY_MAX_MAP_CALLS=10`) bekommen die ersten zwei Quellen in UUID-Ordnung je 4 Batches, die dritte 2, die vierte 0 (`entireSource: true`). Welche Quelle das ist, ist Zufall. Der Eval-Check `mustContain: [/verfahren-4\.txt.*vollständig ausgelassen/]` besteht also nur mit ~25 % Wahrscheinlichkeit, unabhängig von Regressionen. Zusätzlich entspricht die Reihenfolge der Themenblöcke in der Zusammenfassung nicht der Nutzer-Auswahl/Upload-Reihenfolge (docs/architecture.md 5.5 verspricht "Dokumentreihenfolge" nur innerhalb einer Quelle, suggeriert aber stabile Ordnung).
- Lösungsvorschlag: In `listChunksBySources` zusätzlich nach `created_at` der Quelle sortieren bzw. in der Summary-Route die Rows nach der Reihenfolge von `selectedSources` (Upload-/Auswahlreihenfolge) umsortieren, bevor `planSummary` läuft. Eval-Fall 15 dann auf den deterministisch letzten Dateinamen prüfen oder generisch auf `/vollständig ausgelassen/` plus Anzahl.

### [SCHWEREGRAD: mittel] Reduce-Phase kann Marker verschieben oder neu kombinieren; Validierung erkennt nur Bereichsverletzungen
- Stelle: src/lib/rag/summary.ts:178-186, src/app/api/notebooks/[id]/summary/route.ts:156
- Nachweis: Der Reduce-Prompt bittet nur ("Behalte alle [n]-Marker exakt unverändert bei und erfinde keine neuen"), erzwingt aber nichts. `validateCitations(fullText, plan.included)` akzeptiert jeden Marker `1..included.length`. Renummeriert das Modell im Reduce (z. B. [17] zu [3]) oder hängt es einen existierenden, aber falschen Marker an eine Aussage, entsteht ein technisch gültiges Zitat mit falscher Passage. Für Chat ist diese Grenze in docs/architecture.md 5.4 dokumentiert, für den Staged-Summary-Pfad ist das Risiko strukturell höher (zweite Modellstufe ohne Zugriff auf die Originalauszüge) und wird weder dokumentiert noch im Eval geprüft (judgeSummary prüft keine Marker-Passung, judgeFaithfulness läuft nur bei `kind: "chat"`).
- Lösungsvorschlag: Minimal: In der Reduce-Validierung nur Marker akzeptieren, die in den Map-Partials tatsächlich vorkamen (Schnittmenge aus `plan.included` und per Regex aus `partials` extrahierten Markern). Zusätzlich einen `zitate_passend`-Judge-Check für Summary-Fälle im Eval ergänzen.

### [SCHWEREGRAD: mittel] Faithfulness-Judge wird bei Antworten ohne Zitate übersprungen
- Stelle: scripts/eval/run.mjs:299 (`if (testCase.expect.judgeFaithfulness && message.citations.length > 0)`)
- Nachweis: Eine Antwort, deren Marker alle als ungültig gestrippt wurden (oder die gar keine setzt), umgeht den Belegtreue-Check komplett. Bei Fällen mit `citationFiles` fällt das über den Auto-Check auf (`files.length > 0` gefordert), aber Fall 12 (`12-injektion-regeln`, dataset.mjs:249-260) hat weder `citationFiles` noch `citationFilesInclude`: Eine zitatlose, potenziell halluzinierte Antwort mit "11:30"/"13:30" besteht.
- Lösungsvorschlag: Bei `judgeFaithfulness: true` und `citations.length === 0` einen fehlschlagenden Check "Antwort ohne Zitate" eintragen statt den Judge still zu überspringen; Fall 12 um `citationFiles: ["injektion.txt"]` ergänzen.

### [SCHWEREGRAD: mittel] Summary-Judge sieht nur die ersten 6.000 Zeichen des Quelltexts
- Stelle: scripts/eval/run.mjs:185 (`sourceText.slice(0, 6000)`)
- Nachweis: Fall 14 nutzt `verfahren-1.txt` mit ~104.000 Zeichen (90 Kapitel); der Judge für `inhalt_korrekt` ("Keine Aussage widerspricht dem Quelltext oder ist erfunden") sieht ~6 % davon. Aussagen der Zusammenfassung zu Kapiteln jenseits von ~Kapitel 5 kann er weder bestätigen noch widerlegen; das Urteil ist für lange Dokumente nicht belastbar.
- Lösungsvorschlag: Hinweis im Judge-Prompt, dass der Quelltext gekürzt ist und nur Widersprüche zum gezeigten Teil zählen; besser: Quelltext passend zu den zitierten Passagen samplen oder das Limit deutlich erhöhen (Judge-Kosten sind gemessen und klein).

### [SCHWEREGRAD: mittel] Judge ist dasselbe Modell wie das geprüfte System
- Stelle: scripts/eval/run.mjs:145 (`model: process.env.OPENAI_CHAT_MODEL`)
- Nachweis: Faithfulness- und Summary-Urteile werden vom identischen Chat-Modell gefällt, das die Antworten erzeugt. Systematische Schwächen (gleiche Fehlinterpretation einer Passage in Antwort und Urteil) bleiben unsichtbar; der Report kennzeichnet zwar "ai-reviewer", nicht aber die Selbstbewertung.
- Lösungsvorschlag: Separates `OPENAI_JUDGE_MODEL`-ENV mit Fallback auf das Chat-Modell; im Report ausweisen, wenn Judge = SUT-Modell.

### [SCHWEREGRAD: mittel] Chat-History nur per Turn-Zahl budgetiert; vollständige Zusammenfassungen landen ungekürzt im Verlauf, Eval deckt "Summary im Verlauf + Quellenwechsel" nicht ab
- Stelle: src/app/api/notebooks/[id]/chat/route.ts:82-87, src/lib/limits.ts:17, src/app/api/notebooks/[id]/summary/route.ts:158-163
- Nachweis: `slice(-CHAT_HISTORY_MAX_TURNS * 2)` begrenzt auf 12 Nachrichten ohne Token-Obergrenze; Assistant-Antworten dürfen bis `MAX_OUTPUT_TOKENS = 1500` lang sein, d. h. bis zu ~18k Tokens History zusätzlich zum 8k-Kontext. Summary-Antworten werden als normale Messages gespeichert und erscheinen (marker-gestrippt) als faktendichte Assistant-Nachricht im Verlauf. Prompt-Regel 5 deklariert History als Nicht-Quelle, aber der kritische Fall "Zusammenfassung über Quelle A im Verlauf, danach Frage mit nur Quelle B ausgewählt" wird nirgends getestet (Eval 10a/10b testet nur normale Chat-Antworten im Verlauf).
- Lösungsvorschlag: Zusätzliches Token-Budget beim History-Aufbau (z. B. 3-4k, von hinten auffüllen, lange Nachrichten kappen); Eval-Fall analog 10a/10b mit Summary als erstem Schritt ergänzen.

### [SCHWEREGRAD: niedrig] Retrieval-Budgetkürzung bricht ab statt zu überspringen
- Stelle: src/lib/rag/retrieve.ts:36-37 (`if (tokens > budget) break;`)
- Nachweis: Sobald ein Chunk nicht mehr ins Restbudget passt, werden auch alle kleineren nachfolgenden Treffer verworfen. Extremfall: Ein einzelner übergroßer Chunk auf Rang 1 (möglich bei langen Sätzen ohne Satzgrenzen, chunk.ts:96-106 überschreitet das Ziel um die Länge eines Satzes) leert das Ergebnis komplett und erzwingt den NO_ANSWER-Pfad trotz Treffern. Praktisch selten, da 12 × ~500 Tokens unter dem 8.000er-Budget liegen; das Budget ist damit de facto totes Recht.
- Lösungsvorschlag: `continue` statt `break` (Kürzung bleibt rangbasiert, kleinere Treffer rutschen nach) oder bewusst dokumentieren, dass die Abbruch-Semantik gewollt ist.

### [SCHWEREGRAD: niedrig] History-Marker-Stripping trifft legitime Nutzerinhalte
- Stelle: src/app/api/notebooks/[id]/chat/route.ts:86 (`m.content.replace(/\[\d{1,4}\]/g, "")`)
- Nachweis: Das Stripping läuft über alle Rollen, auch User-Messages. Fragt ein Nutzer z. B. "Was bedeutet [42] im Protokoll?" oder nutzt Markdown-Referenzen "[2024]", wird der Inhalt im Verlauf verfälscht; Folgefragen ("und was war mit der zweiten Zahl?") verlieren ihren Bezug. Für Assistant-Messages ist das Stripping korrekt und gewollt.
- Lösungsvorschlag: Stripping auf `m.role === "assistant"` beschränken; frühere User-Fragen enthalten nie servergenerierte Marker.

### [SCHWEREGRAD: niedrig] Whitespace-Bereinigung und Marker-Erkennung ignorieren Code-Blöcke
- Stelle: src/lib/rag/citations.ts:36-46
- Nachweis: `replace(/[ \t]{2,}/g, " ")` kollabiert Einrückungen auch innerhalb von Markdown-Code-Fences in der Antwort (zerstört z. B. zitierte Konfig-Ausschnitte); ebenso wird `foo ;` zu `foo;`. Und ein literal in einem Code-Block zitiertes `[2]` aus dem Quelltext wird als Zitatmarker gewertet (oder gestrippt, falls außerhalb des Bereichs). Randfall, aber vom Nutzer sichtbar.
- Lösungsvorschlag: Vor der Bereinigung Code-Fence-Segmente ausklammern und unverändert wieder einsetzen; die Whitespace-Normalisierung nur auf Fließtextsegmente anwenden.

### [SCHWEREGRAD: niedrig] Leere Map-Partials verschwinden ohne Auslassungshinweis
- Stelle: src/app/api/notebooks/[id]/summary/route.ts:131 (`partials.filter((p) => p.length > 0)`)
- Nachweis: Liefert ein Map-Aufruf einen leeren Content (z. B. Abbruch durch `max_completion_tokens` bei Reasoning-Modellen, Content-Filter), fehlen die Inhalte des gesamten Batches in der Gesamtzusammenfassung, ohne dass `buildOmissionNote` davon weiß; der Nutzer sieht keine Lücke. Zusätzlich kann `SUMMARY_MAP_OUTPUT_TOKENS = 700` ein Partial mitten in der Liste abschneiden (8,5-fache Kompression eines 6.000-Token-Batches), ebenfalls unsichtbar.
- Lösungsvorschlag: Leere Partials als Omission des betreffenden Batches erfassen (Dateiname + `fromLabel` des ersten Batch-Chunks) und `finish_reason === "length"` der Map-Aufrufe loggen.

### [SCHWEREGRAD: niedrig] Refusal-Heuristik mit falsch-positiv-trächtigen Mustern
- Stelle: scripts/eval/dataset.mjs:91-99
- Nachweis: `/geht aus den/` matcht auch bejahende Antworten ("Wie aus den Quellen hervorgeht, ... es geht aus den Auszügen hervor, dass X 42 beträgt"), `/lässt sich .* nicht/` matcht Teilaussagen in inhaltlichen Antworten. Ein substanzieller, nicht verweigernder Text kann so den Check "verweigert ohne Grundlage" bestehen. Die `mustNotContain`-Guards (z. B. `/550/`, Euro-Beträge) fangen die konkreten Fälle meist ab, prüfen aber nur das jeweils bekannte Leck.
- Lösungsvorschlag: Zusätzlich zur Pattern-Heuristik bei `refusal: true` verlangen, dass `message.citations.length === 0` oder die Antwort kurz ist; alternativ den exakten `NO_ANSWER_TEXT` als Primärsignal werten und die Patterns nur als Fallback für modellgenerierte Teil-Refusals.

### [SCHWEREGRAD: niedrig] User-Frage wird vor dem Modellaufruf persistiert; Fehlpfade hinterlassen verwaiste Fragen
- Stelle: src/app/api/notebooks/[id]/chat/route.ts:88
- Nachweis: `insertMessage` für die Frage läuft vor `retrieveChunks` und vor dem Stream. Schlägt Embedding oder Completion fehl, steht die Frage ohne Antwort dauerhaft im Verlauf und zählt künftig gegen das 12-Nachrichten-Fenster, verschiebt also echte Turns hinaus.
- Lösungsvorschlag: Frage erst zusammen mit der Antwort speichern oder im Fehlerpfad die verwaiste Nachricht löschen; mindestens beim History-Aufbau unbeantwortete Schluss-Fragen tolerieren (ist durch das Anhängen der aktuellen Frage ohnehin redundant).

## Positiv (kurz)

- Scoping konsequent: `match_chunks` filtert doppelt auf `notebook_id` und `source_id = any(...)` (002_security_hardening.sql:64-65, `set search_path = ''`, SECURITY INVOKER, RLS aktiv); Quellenauswahl ist Pflicht, wird serverseitig gegen Session + `status = 'ready'` gefiltert, leere Auswahl ist ein Fehler, nie "alle Quellen".
- Zitat-Pipeline sauber: Metadaten und Passage-Snapshots ausschließlich aus DB-Rows (citations.ts:51-61), dadurch robust gegen gelöschte Quellen; ungültige Marker werden gestrippt, verbleibende Marker-Lücken sind konsistent, der NO_ANSWER-Pfad ist ein fixer Text ohne Modellaufruf und ohne Marker.
- Auslassungen bei Zusammenfassungen deterministisch serverseitig (`buildOmissionNote`), nie modellgeneriert; Caps (Batch-Budget, pro Quelle, global) verhindern unbegrenzte Modellaufrufe; Rate-Limit wird vor dem ersten OpenAI-Call gezählt.
- History-als-Kontext-Konzept ist explizit (Marker-Stripping + Prompt-Regel 5) und mit Eval 10a/10b gezielt getestet; Injection-Härtung (Prompt-Regel 4) wird mit zwei realistischen Fällen (11, 12) geprüft.
- Evaluation überdurchschnittlich ehrlich: Dataset vorab fixiert und versioniert, Checks als "auto" vs. "ai-reviewer" gekennzeichnet, technische Zitatvalidität in jedem Fall geprüft, Judge-Token-Verbrauch exakt ausgewiesen, Cleanup und Exit-Codes korrekt.
