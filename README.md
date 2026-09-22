# ORACLE Archiv

Eigenständiger, öffentlicher Reader für `oracread.ishiku.de`. Das öffentliche Repository enthält bewusst keine mitgelieferten Geschichten; Inhalte werden ausschließlich im persistenten Datenverzeichnis der jeweiligen Installation gepflegt.

## Enthalten

- öffentliche Bibliothek mit sortierbaren Büchern und schneller Struktursuche nach Buch-, Kapitel- und Teilenamen sowie Nummern
- pro Buch frei benennbare Struktur, standardmäßig Buch → Kapitel → Episode; Oracle verwendet Archiv → Akte → Fragment
- getrennte Nummerierung pro Buch und Ebene als `1`, `01`, `001`, `0001`, römische Groß- oder Kleinzahl
- positionsgenaue Lesestellen, Lesezeichen, Fortschritt und synchronisierter Gelesen-Status im jeweiligen Browser – ohne Leserkonto
- kompakte Leseeinstellungen in der Reader-Leiste mit vier Themes, verstellbarer Schriftgröße, Serif/Serifenlos, normaler oder umgekehrter Inhaltsübersicht sowie Scroll- und Seitenansicht
- Download veröffentlichter Bücher, Kapitel und Einzelteile als EPUB oder gesetztes PDF
- geschützter Adminbereich mit kryptischen Vorschaulinks, verständlicher Sichtbarkeitshierarchie, Statusfiltern und Veröffentlichungsplan für Bücher, Kapitel und einzelne Leseteile
- eigenständige Vollbild-Redaktion unter `/admin` mit getrennten Bereichen für Inhalte, Darstellung und Links
- Volltextsuche in der geschützten Redaktion, die jede Fundstelle samt Kontext direkt zum passenden Editor führt
- getrennte Bearbeitungsmasken für Buch, Kapitel und Episode; jede Ebene kann gezielt öffentlich ausgeblendet werden
- Kapitel lassen sich innerhalb eines Buchs sortieren oder in ein anderes Buch verschieben
- Releasedaten werden pro Teil gepflegt; Kapitel und Bücher übernehmen automatisch das jeweils jüngste Datum
- persistente Buchcover und ein optionales Bild pro Teil, direkt in der Redaktion hochladbar
- buchtypisch gestaltetes Markdown mit Überschriften, Dialogzeilen, Zitaten, Listen, Tabellen, Links, Bildern und abgesetzten Textblöcken sowie Markdown-/Text-Upload
- getrennte Kapitel- sowie Episoden-TL;DR mit vorgeschalteter Spoilerbestätigung
- Coveransicht in der Bibliothek mit Klappentext beim Darüberfahren, einer mobilen Detailansicht und automatisch gesetztem Archivcover als Rückfall
- frei administrierbare Weblinks und `discord://`-App-Links auf Desktop und Mobilgeräten
- Teilen einzelner Episoden, Touch-Blätterzonen, Tastatursteuerung und abschaltbare Blätteranimationen
- als PWA auf Mobilgeräten installierbar; App-Updates erneuern automatisch nur die Programmdateien, während Lesestatus, Lesezeichen und Fortschritt erhalten bleiben
- die letzte erfolgreich synchronisierte öffentliche Archivfassung bleibt offline vollständig lesbar
- vollständige ZIP-Sicherungen aus Bibliothek und Bildern mit geprüfter Wiederherstellung; ältere JSON-Sicherungen bleiben importierbar
- persistente Inhalte unter `/data`

## Geschichten importieren

Im vollständigen ORACLE-Arbeitsordner mit `npm run import`. Dies erzeugt `data/library.json` aus dem Ordner `Story`. Beim erstmaligen Containerstart wird dieser Stand nach `/data` übernommen; vorhandene Daten werden nicht überschrieben.

## Lokal starten

```bash
ADMIN_PASSWORD='ein-langes-passwort' COOKIE_SECURE=false npm start
```

Danach ist der Reader unter `http://127.0.0.1:4180` erreichbar.

## ZimaOS / Docker Compose

Das Secret muss vor dem Start als `ORACLE_READER_ADMIN_PASSWORD` gesetzt werden – entweder in der ZimaOS-Oberfläche oder in einer lokalen, nicht einzucheckenden `.env` neben der Compose-Datei:

```env
ORACLE_READER_ADMIN_PASSWORD=ein-sehr-langes-eigenes-passwort
```

Danach mit `docker compose pull && docker compose up -d` starten. Verwendet wird `ghcr.io/maroishiku/orac_reader:latest`. Der Reverse Proxy für `oracread.ishiku.de` zeigt wie bisher auf den Host-Port `4180`; ein gemeinsames Docker-Netz ist nicht erforderlich. SSL/HTTPS muss am Proxy aktiv sein und `X-Forwarded-Proto`, `X-Forwarded-Host` sowie `X-Forwarded-For` selbst setzen und eingehende Werte überschreiben. `TRUST_PROXY_HOPS=1` vertraut genau diesem letzten Proxy-Hop. HTTP muss auf HTTPS umgeleitet werden; der Reader leitet zusätzlich selbst um, wenn der Proxy `X-Forwarded-Proto: http` meldet. Für `/sw.js` darf der Proxy keinen eigenen Browsercache hinzufügen, damit installierte Apps neue Versionen zeitnah erkennen.

Der persistente Stand liegt auf dem Host in `./data-runtime` und bleibt bei Containerupdates erhalten.

## Veröffentlichung

Pushes auf `main` veröffentlichen automatisch ein Multi-Arch-Image für AMD64 und ARM64 in der GitHub Container Registry. Neben `latest` wird ein unveränderlicher `sha-…`-Tag erzeugt.
