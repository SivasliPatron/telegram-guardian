# Lokaler Qwen-Dienst für Telegram Guardian

Dieser unabhängige Container betreibt **Qwen 3.5 2B Q4_K_M** mit dem CPU-Server von
`llama.cpp`. Das Modell ist bereits im fertigen Image enthalten. Zur Laufzeit werden daher weder
Gemini noch eine andere externe KI-API oder ein Modelldownload benötigt.

Am veröffentlichten Port läuft nicht `llama.cpp` selbst, sondern ein kleiner Node.js-Proxy. Er
prüft den API-Key und begrenzt Anfragen, Antworten und Parallelität. `llama.cpp` lauscht nur im
Container auf `127.0.0.1:8081` und ist von außen nicht direkt erreichbar.

## Fest gepinnte Bestandteile

| Bestandteil       | Wert                                                               |
| ----------------- | ------------------------------------------------------------------ |
| Modell-Repository | `bartowski/Qwen_Qwen3.5-2B-GGUF`                                   |
| Repository-Commit | `6521bcb22761828aa55639d1c814a207234c3e70`                         |
| Modelldatei       | `Qwen_Qwen3.5-2B-Q4_K_M.gguf`                                      |
| Dateigröße        | `1.329.766.560` Bytes                                              |
| SHA256            | `84aeb7fe40e7b833d71303d7f1b9f9c1991b931b5dbd214e0aa48d56a0af1f85` |
| llama.cpp-Basis   | CPU-Server Build `b9445`, über den Multi-Arch-Digest gepinnt       |
| Proxy-Laufzeit    | Node `24.18.0`, über den Multi-Arch-Digest gepinnt                 |

Beim Imagebau wird ausschließlich die Datei aus diesem Commit heruntergeladen. Der Build bricht
ab, wenn Dateigröße oder SHA256 nicht exakt stimmen.

## Voreinstellungen

- öffentlicher Port: `8080` (authentifizierter Proxy)
- interner llama.cpp-Port: `127.0.0.1:8081` (nicht veröffentlicht)
- anonymer Healthcheck: `GET /health` oder `HEAD /health`
- Inferenz: ausschließlich `POST /v1/chat/completions` mit Bearer-Key
- Gesamtkontext: `8192` Tokens; bei zwei parallelen Slots stehen ungefähr `4096` je Slot bereit
- parallele Slots: `2`
- höchstens `2` gleichzeitig angenommene Proxy-Anfragen
- CPU-Threads: `5`
- Continuous Batching und Promptcache: aktiv
- Thinking-Modus: deaktiviert, damit Moderationsantworten kurz und schnell bleiben
- Weboberfläche und öffentlicher Slot-Endpunkt: deaktiviert
- Modellalias für API-Anfragen: `guardian-qwen-3.5-2b`

Der Proxy akzeptiert keine Streaming-Antworten und keine beliebigen llama.cpp-Optionen. Er erlaubt
maximal vier Textnachrichten, 24.000 Zeichen Prompt, 512 Ausgabetokens, 64 KiB Anfrage und 128 KiB
Antwort. Nicht erlaubte Pfade, Query-Strings und zusätzliche JSON-Felder werden abgewiesen.

## Proxy-Konfiguration

Die sicheren Standardwerte sind bereits im Image gesetzt:

| Variable                        | Standard | Bedeutung                                  |
| ------------------------------- | -------: | ------------------------------------------ |
| `AI_PROXY_MAX_REQUEST_BYTES`    |  `65536` | maximale Größe des JSON-Requests           |
| `AI_PROXY_MAX_RESPONSE_BYTES`   | `131072` | maximale Größe der llama.cpp-Antwort       |
| `AI_PROXY_UPLOAD_TIMEOUT_MS`    |  `10000` | absolutes Zeitlimit für den Request-Upload |
| `AI_PROXY_INFERENCE_TIMEOUT_MS` | `120000` | Zeitlimit einer Inferenz                   |
| `AI_PROXY_MAX_CONCURRENCY`      |      `2` | gleichzeitig angenommene Anfragen          |

`LLAMA_API_KEY` ist verpflichtend und muss mindestens 32 Bytes lang sein. Host und Port des
internen llama.cpp-Prozesses sind absichtlich nicht konfigurierbar; der Proxy erzwingt immer
`127.0.0.1:8081`.

## Empfohlene JustRunMyApp-Ressourcen

Für den Start sind vorgesehen:

- **5 vCPU**
- **5 GB RAM**
- mindestens 4 GB verfügbarer Image-/Instanzspeicher
- kein GPU-Zugriff erforderlich

Das Modell selbst belegt rund 1,33 GB. Beim Start werden zusätzlich Arbeitsspeicher für den
llama.cpp-Prozess, zwei Slots und den KV-Cache benötigt. Wenn JustRunMyApp einen OOM-Neustart
meldet, muss zuerst der RAM erhöht und nicht die Slotzahl vergrößert werden.

## Veröffentlichung über GitHub

Die Workflowdatei `.github/workflows/local-ai-image.yml` baut bei Änderungen unter `local-ai/`
automatisch:

```text
ghcr.io/sivaslipatron/telegram-guardian-ai:latest
```

Zusätzlich wird ein unveränderlicher Tag mit der Commit-SHA veröffentlicht. Ist das GHCR-Paket
privat, benötigt JustRunMyApp einen GitHub-Benutzernamen und ein Token mit `read:packages`.

## JustRunMyApp einrichten

1. Eine **separate App** für den KI-Dienst erstellen. Nicht den bestehenden Bot-Container
   ersetzen.
2. Als Image `ghcr.io/sivaslipatron/telegram-guardian-ai:latest` eintragen.
3. 5 vCPU und 5 GB RAM auswählen.
4. Port `8080` und Healthcheck-Pfad `/health` konfigurieren.
5. Eine zufällige Umgebungsvariable `LLAMA_API_KEY` mit mindestens 32 Bytes setzen.
6. Wenn möglich ausschließlich die interne JustRunMyApp-Adresse verwenden. Falls Port `8080`
   öffentlich erreichbar ist, schützt der Proxy die Inferenz weiterhin mit diesem Key.
7. Die interne Basisadresse und denselben API-Key später beim Bot als lokale KI-Verbindung
   hinterlegen.

Ohne `LLAMA_API_KEY` beendet sich der Container absichtlich sofort. Der Schlüssel wird niemals in
das Image eingebaut.

## Lokaler Build

Der Build lädt ungefähr 1,33 GB herunter und kann entsprechend lange dauern:

```bash
docker build -f local-ai/Dockerfile -t telegram-guardian-ai:local local-ai
```

Start:

```bash
docker run --rm \
  --cpus 5 \
  --memory 5g \
  -e LLAMA_API_KEY='EIN-LANGES-ZUFAELLIGES-GEHEIMNIS' \
  -p 8080:8080 \
  telegram-guardian-ai:local
```

## Funktion prüfen

Der Healthcheck benötigt keinen API-Key:

```bash
curl --fail http://127.0.0.1:8080/health
```

Test der OpenAI-kompatiblen Chat-API:

```bash
curl --fail http://127.0.0.1:8080/v1/chat/completions \
  -H 'Authorization: Bearer EIN-LANGES-ZUFAELLIGES-GEHEIMNIS' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "guardian-qwen-3.5-2b",
    "messages": [
      {"role": "system", "content": "Antworte kurz auf Deutsch."},
      {"role": "user", "content": "Antworte nur mit dem Wort bereit."}
    ],
    "temperature": 0,
    "max_tokens": 16,
    "stream": false
  }'
```

Die Antwort muss unter `choices[0].message.content` stehen.

## Betrieb und Sicherheit

- Das Image ist wegen des eingebetteten Modells deutlich größer als das Bot-Image.
- Modellwechsel erfolgen nur durch einen neuen, erneut hashgeprüften Imagebau.
- Inferenzanfragen laufen ausschließlich über den Proxy und benötigen immer den Bearer-Key.
- Der interne Port `8081` darf niemals in JustRunMyApp veröffentlicht werden.
- Prompt- und Antworttexte gehören nicht in Anwendungslogs.
- Der Promptcache hält gemeinsame Promptteile und zuletzt verwendete Tokens nur flüchtig im RAM;
  er wird bei einem Neustart vollständig verworfen und niemals auf ein Volume geschrieben.
- Der Proxy veröffentlicht keine Weboberfläche, Slot-, Verwaltungs- oder beliebigen llama.cpp-
  Endpunkte. Nur `/health` und `/v1/chat/completions` sind erlaubt.
- Der KI-Dienst speichert keine PostgreSQL- oder Redis-Daten und benötigt kein persistentes Volume.
- Ein Ausfall dieses Containers darf den Bot-Healthcheck nicht auf HTTP 503 setzen; vorhandene
  Wortfilter müssen unabhängig weiterarbeiten.

Die Bot-Integration ist bewusst nicht Bestandteil dieses Ordners. Dadurch kann der KI-Dienst
unabhängig gebaut, getestet, aktualisiert und neu gestartet werden.
