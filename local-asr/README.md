# Lokale Audio-Transkription für Telegram Guardian

Dieser unabhängige Container betreibt das mehrsprachige Modell **Whisper small** mit dem
CPU-Server von `whisper.cpp`. Er nimmt Audiodateien über `POST /inference` an. Das Modell ist im
fertigen Image enthalten; zur Laufzeit gibt es keinen Modelldownload und keine externe
Transkriptions-API.

Der Container verändert oder ersetzt den Telegram-Bot nicht. Er wird als eigene App betrieben.

## Architektur und Sicherheit

```text
Client/Bot -> :8080 Auth-Proxy -> 127.0.0.1:8081 whisper-server
```

`whisper-server` bietet selbst keine API-Key-Authentifizierung. Deshalb lauscht er ausschließlich
auf der internen Loopback-Adresse. Nur der kleine Proxy ist auf Port `8080` erreichbar. Er:

- verlangt `Authorization: Bearer <ASR_API_KEY>` für `/inference`,
- akzeptiert ausschließlich streng geprüftes `multipart/form-data` mit genau einem einfachen
  Boundary-Parameter und genau einer Datei vom Typ `audio/wav`,
- verlangt `Content-Length` und begrenzt das gesamte Multipart-Paket auf 4 MB,
- validiert RIFF/WAVE als PCM16, mono, 16 kHz und höchstens 3.840.000 reale PCM-Bytes
  beziehungsweise 120 Sekunden,
- lässt nur eine Inferenz gleichzeitig zu,
- entfernt den ursprünglichen Upload-Dateinamen aus den Multipart-Headern,
- erlaubt nur die für den Bot benötigten, fest validierten Steuerfelder,
- stellt den keyfreien, inhaltsarmen Healthcheck `/health` bereit,
- veröffentlicht weder die Whisper-Weboberfläche noch den dynamischen `/load`-Endpunkt.

Der Prozess läuft ohne Root-Rechte. Der Proxy nimmt absichtlich keine komprimierten Formate wie
OGG oder MP3 an und startet keinen Konverter. Der Telegram-Bot wandelt zulässige Sprachnachrichten
bereits vor dem Upload begrenzt in das geforderte WAV-Format um. Auch die von `ffmpeg` bei einer
Pipe-Ausgabe verwendeten Größenwerte `0xffffffff` werden akzeptiert; entscheidend ist immer die
tatsächlich vorhandene, bytegenau begrenzte PCM-Datenmenge. Bei einem Inferenz-Timeout oder einem
Clientabbruch während der laufenden Inferenz beendet der Proxy Whisper und sich selbst hart, damit
kein unsichtbar weiterlaufender oder überlappender Job zurückbleibt. Die Plattform startet den
Container anschließend neu.

## Fest gepinnte Bestandteile

| Bestandteil             | Wert                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| Modell-Repository       | `ggerganov/whisper.cpp`                                                         |
| Repository-Commit       | `5359861c739e955e79d9a303bcbc70fb988958b1`                                      |
| Modelldatei             | `ggml-small.bin`                                                                |
| Dateigröße              | `487.601.967` Bytes                                                             |
| SHA256                  | `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`              |
| whisper.cpp-Basis-Image | Build `27101c01dcac1676e2b6422256233cd0f1f9ae28`, zusätzlich per Digest gepinnt |
| Proxy-Laufzeit          | Node.js `24.18.0` aus dem offiziellen, per Digest gepinnten Node-Image          |

Beim Imagebau wird genau die Modelldatei aus diesem Commit heruntergeladen. Der Build bricht ab,
wenn Dateigröße oder SHA256 nicht exakt stimmen. Es handelt sich um das vollständige
mehrsprachige `small`-Modell, nicht um die nur englische `.en`-Variante.

## Voreinstellungen

- öffentlicher Container-Port: `8080`
- interner Whisper-Port: `127.0.0.1:8081`
- Healthcheck: `GET /health`
- Inferenz: `POST /inference`
- CPU-Threads: `5`
- Sprache: automatische Erkennung
- maximaler Multipart-Upload: `4.000.000` Bytes
- WAV-Nutzdaten: PCM16, mono, 16 kHz, maximal `3.840.000` reale Datenbytes
- Inferenz-Zeitlimit: `180` Sekunden
- maximal verarbeitete Audiodauer: `120` Sekunden
- maximale Parallelität: eine Anfrage

Konfigurierbare Umgebungsvariablen:

| Variable                   | Pflicht/Standard | Bedeutung                                    |
| -------------------------- | ---------------- | -------------------------------------------- |
| `ASR_API_KEY`              | Pflicht          | mindestens 32 Bytes, niemals ins Image bauen |
| `ASR_MAX_UPLOAD_BYTES`     | `4000000`        | gesamtes Multipart-Uploadlimit               |
| `ASR_UPLOAD_TIMEOUT_MS`    | `30000`          | Zeitlimit für den Upload                     |
| `ASR_INFERENCE_TIMEOUT_MS` | `180000`         | Zeitlimit für Whisper                        |
| `WHISPER_THREADS`          | `5`              | CPU-Threads, passend zu den gebuchten vCPUs  |
| `WHISPER_MAX_DURATION_MS`  | `120000`         | höchstens verarbeitete Audiodauer            |

## GitHub Container Registry

Die Workflowdatei `.github/workflows/local-asr-image.yml` baut bei Änderungen unter `local-asr/`:

```text
ghcr.io/sivaslipatron/telegram-guardian-asr:latest
```

Zusätzlich wird ein unveränderlicher Tag mit der vollständigen Git-Commit-SHA veröffentlicht. Ist
das GHCR-Paket privat, benötigt JustRunMyApp einen GitHub-Benutzernamen und ein klassisches Token
mit mindestens `read:packages`.

## JustRunMyApp Schritt für Schritt

1. Eine **neue, separate App** für Audio-Transkription erstellen. Nicht Bot, PostgreSQL, Valkey
   oder die lokale Text-KI ersetzen.
2. Als Container-Image `ghcr.io/sivaslipatron/telegram-guardian-asr:latest` eintragen.
3. Als Architektur `linux/amd64`, mindestens **5 vCPU**, **5 GB RAM** und ungefähr 2 GB freien
   Image-/Instanzspeicher verwenden. Eine GPU wird nicht benötigt.
4. Den HTTP-Port auf `8080` setzen.
5. Als Healthcheck `GET /health` auf Port `8080` eintragen. Während das Modell startet, antwortet
   dieser bewusst mit HTTP 503; danach mit HTTP 200 und `{"status":"ok"}`.
6. `ASR_API_KEY` als geheime Umgebungsvariable setzen. Einen zufälligen Wert mit mindestens 32
   Zeichen verwenden, zum Beispiel mit `openssl rand -hex 32` erzeugt.
7. Wenn JustRunMyApp interne/private Service-Adressen anbietet, nur diese Adresse für den Bot
   verwenden. Andernfalls ausschließlich die von JustRunMyApp bereitgestellte HTTPS-Adresse
   nutzen und die öffentliche Erreichbarkeit zusätzlich begrenzen.
8. Die App starten und warten, bis der Healthcheck grün ist.

Im Bot anschließend `LOCAL_ASR_BASE_URL` auf die interne ASR-Adresse, `LOCAL_ASR_API_KEY` auf
denselben Schlüssel und `LOCAL_ASR_TIMEOUT_MS=180000` setzen. Die Basisadresse enthält keinen
`/inference`-Anhang; der Bot ergänzt diesen Pfad selbst. Danach den Bot neu starten.

Der API-Key darf nicht in GitHub, Dockerfile, Screenshots oder Chatnachrichten gespeichert werden.

## Lokal bauen und starten

Der Build lädt rund 488 MB Modelldaten herunter:

```bash
docker build -f local-asr/Dockerfile -t telegram-guardian-asr:local local-asr
```

```bash
docker run --rm \
  --cpus 5 \
  --memory 5g \
  --read-only \
  -e ASR_API_KEY='EIN-LANGES-ZUFAELLIGES-GEHEIMNIS' \
  -p 8080:8080 \
  telegram-guardian-asr:local
```

Falls JustRunMyApp einen schreibgeschützten Root-Dateisystem-Schalter anbietet, kann er ebenfalls
aktiviert werden. Der Dienst benötigt für die Audioverarbeitung kein beschreibbares Volume und
kein temporäres Konvertierungsverzeichnis.

## Funktion prüfen

Healthcheck ohne Schlüssel:

```bash
curl --fail http://127.0.0.1:8080/health
```

Transkription mit Bearer-Key:

```bash
curl --fail http://127.0.0.1:8080/inference \
  -H 'Authorization: Bearer EIN-LANGES-ZUFAELLIGES-GEHEIMNIS' \
  -F 'file=@beispiel.wav;type=audio/wav' \
  -F 'response_format=json' \
  -F 'language=auto'
```

Die JSON-Antwort enthält das erkannte Transkript. Bei `401` stimmen API-Key oder Header nicht;
`413` bedeutet, dass das gesamte Multipart-Paket das Uploadlimit überschreitet; `429` bedeutet,
dass gerade bereits eine Transkription läuft.

`beispiel.wav` muss RIFF/WAVE mit PCM16, einem Kanal und 16.000 Hz sein. Andere WAV-Codecs,
Stereodateien, abweichende Abtastraten sowie OGG oder MP3 werden mit HTTP 400 abgelehnt.

Erlaubt sind genau eine Datei im Feld `file` sowie optional `temperature=0`,
`temperature_inc=0`, `language=auto|de|en|tr`, `translate=false` und
`response_format=json`. Andere Whisper-Steuerfelder werden mit HTTP 400 abgelehnt, damit unter
anderem Zeit- und Debug-Grenzen nicht pro Anfrage überschrieben werden können.

## Betriebshinweise

- Keine Datenbank und kein persistentes Volume sind erforderlich.
- Healthchecks und Neustarts dieses Containers müssen unabhängig vom Bot bleiben.
- Audioinhalt wird nicht durch den Proxy protokolliert. Auch Clients sollten neutrale Dateinamen
  verwenden und weder Schlüssel noch Transkripte loggen.
- Ein Inferenz-Timeout oder Clientabbruch während Whisper rechnet beendet den Container absichtlich
  mit einem Fehlerstatus. Ein Plattform-Neustart ist in diesem Fall erwartetes Schutzverhalten.
- Das Modell ist robust mehrsprachig, aber nicht unfehlbar. Moderationsentscheidungen dürfen nicht
  allein aus einer unsicheren Transkription entstehen.
- Whisper besitzt keinen eigenen Kurmancî-Sprachcode. Kurmancî-Audio läuft deshalb nur über die
  automatische Erkennung und kann deutlich ungenauer transkribiert werden; solche Ergebnisse sind
  ausschließlich Hinweise für Administratoren und niemals eine Grundlage für automatische Strafen.
- Bei Zeitüberschreitungen zuerst Audiodauer und CPU-Auslastung prüfen. Das Uploadlimit sollte
  nicht erhöht werden; die feste PCM-Obergrenze von 120 Sekunden bleibt unabhängig davon aktiv.
