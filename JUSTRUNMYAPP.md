# Upload zu JustRunMy.App

Dieses Paket enthält nur die Bot-Anwendung. PostgreSQL und Redis/Valkey werden im JustRunMy.App-Panel als separate Dienste angelegt.

## 1. Datenbanken anlegen

1. Ein PostgreSQL-Template erstellen und einen persistenten Datenträger aktivieren.
2. Ein Redis/Valkey-Template erstellen und ebenfalls Persistenz aktivieren.
3. Die internen Verbindungsadressen beider Dienste kopieren.
4. Datenbank und Redis nicht als öffentliche Ports freigeben.

Die PostgreSQL-Adresse muss mit `postgresql://` beginnen. Falls das Panel `postgres://` ausgibt, darf nur dieses Präfix zu `postgresql://` geändert werden. Redis/Valkey muss als `redis://`-Adresse eingetragen werden.

## 2. Lokale 2B-KI anlegen

1. Eine neue Anwendung aus einem Docker-Image erstellen.
2. Als Image `ghcr.io/sivaslipatron/telegram-guardian-ai:latest` verwenden.
3. **5 vCPU**, **5 GB RAM**, Port `8080` und Healthcheck `/health` einstellen.
4. Einen langen zufälligen Schlüssel als `LLAMA_API_KEY` setzen.
5. Die App starten, auf einen grünen Healthcheck warten und ihre interne beziehungsweise
   geschützte HTTPS-Adresse kopieren.

Dieser Dienst enthält Qwen 3.5 2B Q4_K_M. Nachrichten, sichtbare Namen und `/ki` werden lokal
verarbeitet; es gibt kein RPD-/RPM-Kontingent eines externen KI-Anbieters. Details und ein
Funktionstest stehen in `local-ai/README.md`.

## 3. Lokale Audio-Transkription anlegen

1. Eine weitere Anwendung aus
   `ghcr.io/sivaslipatron/telegram-guardian-asr:latest` erstellen.
2. **5 vCPU**, **5 GB RAM**, Port `8080` und Healthcheck `/health` einstellen.
3. Einen zweiten langen zufälligen Schlüssel als `ASR_API_KEY` setzen.
4. Die App starten, auf einen grünen Healthcheck warten und ihre Adresse kopieren.

Sprachnachrichten werden dort lokal mit Whisper small in Text umgewandelt. Danach bewertet der
Qwen-2B-Dienst aus Schritt 2 das Transkript. Details stehen in `local-asr/README.md`.

## 4. Bot hochladen

1. In JustRunMy.App eine neue Anwendung erstellen.
2. ZIP-Upload auswählen und dieses Archiv hochladen.
3. Wenn nach der Laufzeit gefragt wird, **Dockerfile/Docker** auswählen.
4. Keinen eigenen Startbefehl eintragen. Der Docker-Startbefehl führt zuerst `prisma migrate deploy` und anschließend den Bot aus.
5. Port `3000` als HTTP-/Health-Port eintragen.
6. Als Healthcheck-Pfad `/health` verwenden.

## 5. Umgebungsvariablen

Alle Werte aus `justrunmyapp.env.example` im Panel anlegen und die Platzhalter ersetzen.

- `LOCAL_AI_BASE_URL`: Adresse aus Schritt 2, ohne `/v1/chat/completions`
- `LOCAL_AI_API_KEY`: exakt derselbe Wert wie `LLAMA_API_KEY`
- `LOCAL_ASR_BASE_URL`: Adresse aus Schritt 3, ohne `/inference`
- `LOCAL_ASR_API_KEY`: exakt derselbe Wert wie `ASR_API_KEY`
- `AI_PROVIDER=local`: garantiert, dass keine Nachricht an Gemini geschickt wird
- `LOCAL_SERVICES_ALLOW_INSECURE_HTTP=false`: bei HTTPS; nur für ein nachweislich internes
  JustRunMyApp-HTTP-Netz auf `true` setzen

Das Bot-Token und beide lokalen API-Schlüssel gehören ausschließlich in die sicheren
Umgebungsvariablen des Panels und niemals in das ZIP-Archiv oder einen Chat.

## 6. Start kontrollieren

Nach dem Deployment müssen die Logs unter anderem Folgendes zeigen:

```text
Telegram-Bot startet im Long-Polling-Modus
Telegram-Bot ist bereit
```

Der Bot-Healthcheck muss danach HTTP 200 mit `{"status":"ok"}` zurückgeben. HTTP 503 bedeutet,
dass PostgreSQL oder Redis nicht erreichbar ist. Zusätzlich müssen die beiden KI-App-Healthchecks
grün sein.

## 7. Telegram konfigurieren

- Privacy Mode bei BotFather deaktivieren.
- Bot als Gruppenadministrator hinzufügen.
- Rechte zum Löschen von Nachrichten und Einschränken/Sperren von Mitgliedern erteilen.
- Für den Admin-Log den Bot in einen privaten Kanal aufnehmen und anschließend in der Gruppe `/setlogchannel -100...` ausführen.

Die vollständige Befehls- und Sicherheitsbeschreibung steht in `README.md`.
