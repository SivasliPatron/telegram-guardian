# Upload zu JustRunMy.App

Dieses Paket enthält nur die Bot-Anwendung. PostgreSQL und Redis/Valkey werden im JustRunMy.App-Panel als separate Dienste angelegt.

## 1. Datenbanken anlegen

1. Ein PostgreSQL-Template erstellen und einen persistenten Datenträger aktivieren.
2. Ein Redis/Valkey-Template erstellen und ebenfalls Persistenz aktivieren.
3. Die internen Verbindungsadressen beider Dienste kopieren.
4. Datenbank und Redis nicht als öffentliche Ports freigeben.

Die PostgreSQL-Adresse muss mit `postgresql://` beginnen. Falls das Panel `postgres://` ausgibt, darf nur dieses Präfix zu `postgresql://` geändert werden. Redis/Valkey muss als `redis://`-Adresse eingetragen werden.

## 2. Bot hochladen

1. In JustRunMy.App eine neue Anwendung erstellen.
2. ZIP-Upload auswählen und dieses Archiv hochladen.
3. Wenn nach der Laufzeit gefragt wird, **Dockerfile/Docker** auswählen.
4. Keinen eigenen Startbefehl eintragen. Der Docker-Startbefehl führt zuerst `prisma migrate deploy` und anschließend den Bot aus.
5. Port `3000` als HTTP-/Health-Port eintragen.
6. Als Healthcheck-Pfad `/health` verwenden.

## 3. Umgebungsvariablen

Alle Werte aus `justrunmyapp.env.example` im Panel anlegen und die Platzhalter ersetzen. Das Bot-Token gehört ausschließlich in die sicheren Umgebungsvariablen des Panels und niemals in das ZIP-Archiv.

## 4. Start kontrollieren

Nach dem Deployment müssen die Logs unter anderem Folgendes zeigen:

```text
Telegram-Bot startet im Long-Polling-Modus
Telegram-Bot ist bereit
```

Der Healthcheck muss danach HTTP 200 mit `{"status":"ok"}` zurückgeben. HTTP 503 bedeutet, dass PostgreSQL oder Redis nicht erreichbar ist.

## 5. Telegram konfigurieren

- Privacy Mode bei BotFather deaktivieren.
- Bot als Gruppenadministrator hinzufügen.
- Rechte zum Löschen von Nachrichten und Einschränken/Sperren von Mitgliedern erteilen.
- Für den Admin-Log den Bot in einen privaten Kanal aufnehmen und anschließend in der Gruppe `/setlogchannel -100...` ausführen.

Die vollständige Befehls- und Sicherheitsbeschreibung steht in `README.md`.
