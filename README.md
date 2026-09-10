# ORACLE Archiv

Eigenständiger, öffentlicher Reader für `oracle.ishiku.de`. OracleDB bleibt als separate Anwendung unter `oracledb.ishiku.de`; beide Seiten sind lediglich über normale Links verbunden.

## Enthalten

- öffentliche Bibliothek mit Volltextsuche, Weiterlesen, zuletzt gelesenen und neuen Einträgen
- klare Struktur Archiveintrag → Kapitel → Teil, einschließlich Kapitelnummer `0` und wählbarer Darstellung als `1`, `01`, `001` oder `0001`
- automatische Leseposition, Fortschritt und synchronisierter Gelesen-Status im jeweiligen Browser – ohne Leserkonto
- vier kontrastgeprüfte Lesethemes, verstellbare Schriftgröße sowie echte Scroll- und Seitenansicht
- geschützter Adminbereich für Entwurf, kryptischen Vorschaulink, geplante Veröffentlichung und Veröffentlichung
- getrennte Bearbeitungsmasken für Archiveintrag, Kapitel und Teil; Kapitel lassen sich ziehen oder über Pfeile sortieren
- Markdown-/Text-Upload und getrennte Kapitel- sowie Teil-TL;DR mit vorgeschalteter Spoilerbestätigung
- automatisch gesetzte Archivcover mit offizieller Kapitel-/Teilnummer
- frei administrierbare Weblinks und `discord://`-App-Links auf Desktop und Mobilgeräten
- Teilen einzelner Teile, Touch-Blätterzonen, Tastatursteuerung und abschaltbare Blätteranimationen
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

Danach mit `docker compose pull && docker compose up -d` starten. Verwendet wird `ghcr.io/maroishiku/orac_reader:latest`. Der Reverse Proxy für `oracle.ishiku.de` zeigt auf Port `4180`. SSL/HTTPS muss am Proxy aktiv sein, da der produktive Sitzungscookie nur über HTTPS übertragen wird.

Der persistente Stand liegt auf dem Host in `./data-runtime` und bleibt bei Containerupdates erhalten.

## Veröffentlichung

Pushes auf `main` veröffentlichen automatisch ein Multi-Arch-Image für AMD64 und ARM64 in der GitHub Container Registry. Neben `latest` wird ein unveränderlicher `sha-…`-Tag erzeugt.
