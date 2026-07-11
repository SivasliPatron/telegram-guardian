# Telegram Supergroup Guardian

Ein modularer Moderationsbot für große Telegram-Supergruppen. Die Anwendung läuft per Long Polling, speichert dauerhafte Zustände in PostgreSQL und nutzt Redis für schnelle Schutzlogik, Update-Deduplizierung, Caches und persistente BullMQ-Jobs.

## Funktionsumfang

- Begrüßung mehrerer neuer Mitglieder, Bot-Ausnahme, Regel-Button und geplantes Löschen
- Regeln pro Gruppe: `/rules`, `/regeln`, `/setrules`
- Verwarnungen: `/warn`, `/warnings`, `/unwarn`, `/clearwarnings`; automatische zeitliche Stummschaltung ab dem konfigurierten Grenzwert
- Moderation: `/mute`, `/tmute`, `/unmute`, `/ban`, `/tban`, `/unban`, `/kick`
- Redis-basierter Sliding-Window-Floodschutz ohne PostgreSQL-Zugriff pro Nachricht
- Link-, Einladungs-, Kurzlink-, Username-, Weiterleitungs-, Telefon- und E-Mail-Schutz mit gecachten Domain-Ausnahmen
- Sichere Wortfilter mit `exact`, `contains` und geprüften regulären Ausdrücken sowie Aktionen `delete`, `warn`, `mute`, `log`, `reply`
- Verwaltete Standardfilter für deutsche, türkische und kurmancî Beleidigungen sowie vulgäre Angriffe auf islamische Heiligtümer; Leetspeak, unsichtbare Zeichen, Buchstabenwiederholungen und einfache Trennzeichen werden normalisiert, während neutrale Religionsbegriffe erlaubt bleiben
- KI-Grenzfälle mit markierter Admin-Prüfung und einmalig entscheidbaren Buttons für „Verwarnung: Ja/Nein“; bestätigte Sätze werden als exakte automatische Wortfilter gelernt, klare Verstöße bleiben automatisch moderiert
- Konfigurierbarer Namensschutz für Beitrittsanfragen, neue Mitglieder und spätere Profiländerungen
- Persistenter Nachtmodus und automatische Nachrichten mit IANA-Zeitzonen
- Optionale Inaktivitätsbereinigung: bekannte Mitglieder werden nach 7 Tagen ohne Gruppenbeitrag markiert und nach weiteren 24 Stunden ohne Aktivität entfernt
- Admin-Log, interne Moderatoren und vertrauenswürdige Mitglieder
- Rollenabhängige Hilfe, Benutzerinformationen, `/mydata` und `/deletemydata`
- Eigene Textbefehle pro Gruppe
- Deutsch als Standardsprache; Türkisch und Kurdisch (Kurmancî) mit deutschem Fallback
- Strukturierte, redigierte Logs, Telegram-Retries mit Backoff, Healthcheck und Graceful Shutdown

Die Schutzmodule lassen sich pro Gruppe deaktivieren: Begrüßung, Floodschutz, Linkschutz, Nachtmodus und Inaktivitätsbereinigung besitzen eigene Flags; Filter, automatische Nachrichten, eigene Befehle und Admin-Logging besitzen je Eintrag bzw. Konfiguration ein Aktiv-Flag. Die Inaktivitätsbereinigung ist standardmäßig ausgeschaltet.

## Voraussetzungen

- Docker Engine mit Docker Compose (empfohlen), oder
- Node.js 22+, PostgreSQL 16+ und Redis 7+

## BotFather und Telegram einrichten

1. In Telegram [@BotFather](https://t.me/BotFather) öffnen und `/newbot` ausführen.
2. Anzeigenamen und eindeutigen Benutzernamen wählen.
3. Das Token kopieren und ausschließlich als `BOT_TOKEN` in `.env` speichern.
4. In BotFather `/setprivacy` wählen, den Bot auswählen und Privacy Mode mit **Disable** ausschalten. Andernfalls sieht der Bot normale Gruppennachrichten nicht und Flood-, Link- und Wortschutz können nicht funktionieren.
5. Den Bot zur Telegram-Supergruppe hinzufügen.
6. Den Bot zum Administrator machen und nur diese Rechte erteilen:
   - Nachrichten löschen
   - Nutzer sperren bzw. Mitglieder einschränken
   - Nutzer hinzufügen, wenn Beitrittsanfragen durch den Namensschutz verarbeitet werden sollen
7. Nicht erforderlich und aus Sicherheitsgründen nicht empfohlen sind:
   - neue Administratoren hinzufügen
   - Gruppeninformationen ändern
   - Nachrichten anheften
   - Videochats oder Stories verwalten
   - anonym bleiben
8. Einen privaten Kanal für Moderationsprotokolle erstellen, den Bot als Administrator mit dem Recht **Nachrichten posten** hinzufügen und die numerische Kanal-ID ermitteln.
9. In der Gruppe `/setlogchannel -1001234567890` ausführen. Gespeichert wird die ID erst, nachdem eine Testnachricht erfolgreich versendet wurde.
10. Die Befehle können optional zusätzlich über BotFather veröffentlicht werden; beim Start registriert der Bot sie automatisch über `setMyCommands`.

Damit Namen bereits vor dem Beitritt geprüft werden, muss die Gruppe bzw. der verwendete Einladungslink auf **Beitrittsanfragen mit Admin-Bestätigung** gestellt sein. Ohne Beitrittsanfrage prüft der Bot das neue Mitglied unmittelbar nach dem Eintritt und entfernt es bei einem Treffer wieder.

Wichtig: Der Bot prüft vor Mute/Ban/Kick seine Telegram-Rechte sowie den Status des Ziels. Administratoren und Gruppeneigentümer sind geschützt.

## Konfiguration

```bash
cp .env.example .env
```

| Variable            | Bedeutung                                                       | Beispiel                                                   |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `BOT_TOKEN`         | Token von BotFather                                             | `123456:ABC...`                                            |
| `DATABASE_URL`      | PostgreSQL-Verbindung; in Compose durch den Servicewert ersetzt | `postgresql://telegram_bot:...@postgres:5432/telegram_bot` |
| `REDIS_URL`         | Redis-Verbindung                                                | `redis://redis:6379`                                       |
| `NODE_ENV`          | `development`, `test` oder `production`                         | `production`                                               |
| `LOG_LEVEL`         | Pino-Loglevel                                                   | `info`                                                     |
| `DEFAULT_TIMEZONE`  | gültige IANA-Zeitzone                                           | `Europe/Berlin`                                            |
| `OWNER_TELEGRAM_ID` | numerische Telegram-ID des globalen Betreibers                  | `123456789`                                                |
| `HEALTH_PORT`       | interner HTTP-Healthcheck                                       | `3000`                                                     |
| `POSTGRES_PASSWORD` | URL-sicheres Kennwort des Compose-PostgreSQL-Dienstes           | ein langes alphanumerisches Zufallskennwort                |

Alle Pflichtwerte werden beim Start mit Zod validiert. `.env` ist per `.gitignore` und `.dockerignore` ausgeschlossen.

## Start mit Docker Compose

```bash
docker compose up --build -d
docker compose logs -f bot
```

Compose startet PostgreSQL und Redis mit persistenten Volumes und Healthchecks. Der Bot wartet auf gesunde Dienste, führt `prisma migrate deploy` aus und startet danach im Long-Polling-Modus. Status prüfen:

```bash
docker compose ps
```

Stoppen, ohne Daten zu löschen:

```bash
docker compose down
```

Kein `-v` verwenden, sofern die Datenbank und Redis-Daten erhalten bleiben sollen.

## Lokale Entwicklung

```bash
npm install
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

PostgreSQL und Redis müssen erreichbar sein. Für einen neuen Schema-Stand wird lokal `npm run prisma:migrate` verwendet; Produktion verwendet ausschließlich `npm run prisma:deploy`.

Qualitätsprüfungen:

```bash
npm run build
npm run lint
npm test
npm run format:check
```

## Befehle und Syntax

Ziele werden mit `@Benutzername` angegeben. Der Nutzer muss dem Bot durch eine Aktivität in der Gruppe bekannt sein.

### Mitglieder

- `/help`, `/rules`, `/regeln`, `/userinfo`, `/warnings`, `/nightstatus`, `/commands`, `/mydata`, `/deletemydata`

### Moderatoren

- `/warn @Nutzer Grund`
- `/warnings @Nutzer`
- `/unwarn @Nutzer`
- `/mute @Nutzer Grund`, `/tmute @Nutzer 2h Grund`, `/unmute @Nutzer`
- `/ban @Nutzer Grund`, `/tban @Nutzer 3d Grund`, `/unban @Nutzer`, `/kick @Nutzer`

Zeitangaben: `10m`, `2h`, `3d`, `1w`; maximal 366 Tage.

### Administratoren

- `/setrules Text`
- `/setupgroup` installiert die empfohlenen Regeln und mehrsprachigen Schutzfilter
- `/inaktiv`, `/inaktiv status`, `/inaktiv an`, `/inaktiv aus`
- `/addforbiddenname Verbotener Name`
- `/forbiddennames`, `/removeforbiddenname EINTRAGS-ID`
- `/nameguard on|off`
- `/welcome on|off`
- `/antilink on|off`
- `/allowdomain example.org`, `/removedomain example.org`
- `/allowuser @Nutzer`, `/removealloweduser @Nutzer`
- `/trust @Nutzer`, `/untrust @Nutzer`, `/promotemod @Nutzer`
- `/clearwarnings @Nutzer`
- `/nightmode on|off`, `/setclosetime 00:00`, `/setopentime 12:00`, `/nightstatus`
- `/setlogchannel -100...`
- `/addfilter contains delete wort`
- `/addfilter regex mute 10m ^spam+$`
- `/addfilter exact reply hallo | Willkommen!`
- `/presetfilters on|off`
- `/filters`, `/removefilter FILTER_ID`
- `/schedulemessage 18:30 1,2,3,4,5 Nachrichtentext`
- `/scheduledmessages`, `/deletescheduledmessage ID`
- `/addcommand shisha Antworttext`, `/removecommand shisha`, `/commands`

Bei der Inaktivitätsbereinigung ist ein „Kick“ technisch eine kurze Sperre mit sofortiger
Entsperrung, damit die Person später wieder beitreten kann. Telegram löscht bei diesem Vorgang in
Supergruppen auch die bisherigen Nachrichten der entfernten Person.

Bei Wochentagen steht `0` für Sonntag, `1` für Montag bis `6` für Samstag.

### Eigentümer

- `/demotemod @Nutzer`

Die Ausgabe von `/help` wird serverseitig nach der tatsächlich ermittelten Rolle gefiltert. Telegram-Gruppenadmins werden automatisch als Admin erkannt.

Der Namensschutz vergleicht Vorname, Nachname und `@Benutzername` ohne Beachtung der Großschreibung. Unsichtbare Zeichen sowie einfache Trennzeichen umgehen die Prüfung nicht. Bei einer abgelehnten Beitrittsanfrage erhält die Person privat den Hinweis, ihren Namen zu ändern. Telegram sendet Bots kein separates Gruppenereignis bei einer späteren Profiländerung; deshalb wird ein bereits aufgenommenes Mitglied bei seiner nächsten Aktivität erneut geprüft und gegebenenfalls entfernt. Die Entfernung ist kein dauerhafter Ban: Nach der Namensänderung kann die Person erneut beitreten.

Die Inaktivitätsbereinigung beginnt beim erstmaligen Einschalten mit einer neuen sicheren Beobachtungsphase. Vorherige Zeitstempel führen deshalb nicht zu einer sofortigen Entfernung. Nach 7 Tagen ohne neuen Gruppenbeitrag markiert der Bot bekannte Mitglieder öffentlich; jede neue Gruppenaktivität innerhalb der anschließenden 24 Stunden bricht die Entfernung ab. Gruppeneigentümer, Telegram-Admins, interne Admins und Moderatoren, vertrauenswürdige Mitglieder sowie Bots sind ausgenommen. Telegram stellt Bots keine vollständige Mitgliederliste bereit, daher kann die Funktion ausschließlich Personen berücksichtigen, die dem Bot seit der Erfassung bekannt sind.

## Architektur

```text
src/
├── bot/                 Bot-Erzeugung und Modulregistrierung
├── commands/            zentrale Command Registry
├── config/              Zod-Umgebung und Logging
├── database/            Prisma-Client und Repositories
├── handlers/            reserviert für modulübergreifende Handler
├── jobs/                BullMQ Worker und persistente Scheduler
├── locales/             Übersetzungen mit Fallback
├── middleware/          Gruppe, Deduplizierung, Rate-Limit, Fehler
├── modules/             fachlich getrennte Botmodule
├── services/            Redis, Rechte, Settings, Admin-Log, Health
├── types/               Kontext und Dependency-Typen
└── utils/               Dauer, Zeit, Filter, Links, Telegram-Escaping
```

Der Minuten-Job gleicht den gewünschten Nachtstatus mit dem gespeicherten Status ab. Dadurch wird eine während eines Neustarts verpasste Umschaltung nachgeholt. Redis-Locks verhindern doppelte Ausführung; BullMQ bewahrt Zeitpläne in Redis auf. Automatische Nachrichten verwenden zusätzlich einen lokalen Zeit-/Zeitzonen-Schlüssel zur Idempotenz.

## Datenschutz und Sicherheit

- Telegram-IDs werden in PostgreSQL als `BigInt` gespeichert.
- Für die optionale Inaktivitätsbereinigung speichert der Bot pro bekanntem Gruppenmitglied den letzten Aktivitätszeitpunkt und vorübergehende Warn-/Entfernungszeitpunkte, jedoch keinen Nachrichteninhalt. Beim Ausschalten werden offene Zustände nicht bereits entfernter Mitglieder gelöscht.
- Potenziell kritische Nachrichten werden für eine offene Admin-Prüfung höchstens 24 Stunden gespeichert und danach verworfen. Bei einer bestätigten Verwarnung bleibt der vollständige Originaltext als exakter Wortfilter erhalten, bis ein Admin den Filter entfernt; der angezeigte Moderationsgrund wird auf 700 Zeichen begrenzt.
- `/deletemydata` anonymisiert entbehrliche Profildaten. Warnungen und Moderationshistorie bleiben aus Sicherheits- und Nachweispflichten minimal zugeordnet; der Bot erklärt dies transparent.
- Adminbefehle werden serverseitig geprüft. Benutzertexte werden für HTML-Ausgaben escaped.
- Reguläre Ausdrücke sind auf 200 Zeichen begrenzt, werden kompiliert und mit `safe-regex2` auf riskante Laufzeitmuster geprüft.
- Logs redigieren Token, Kennwörter und Autorisierungsheader.
- Ausgehende Telegram-Aufrufe behandeln Rate-Limits, Netzwerkfehler und Serverfehler mit begrenztem Backoff.

## Healthcheck und Betrieb

`GET /health` prüft PostgreSQL und Redis. Ein nicht erreichbarer Dienst liefert HTTP 503. Docker startet den Bot bei Fehlern automatisch neu. `SIGINT` und `SIGTERM` stoppen Polling, Worker, Datenbank und Redis geordnet.

Für Webhooks kann später die Startschicht in `src/index.ts` gegen einen HTTP-Adapter ausgetauscht werden; Module und Services sind davon unabhängig.

## Grenzen der Version 1

- Eigene Befehle unterstützen derzeit Textantworten; das Prisma-Schema enthält bereits das optionale Button-Feld, aber die Admin-Syntax für Buttons ist noch nicht freigeschaltet.
- Automatische Nachrichten senden Text. Native Telegram-Umfragen und eine Löschzeit in der Admin-Befehlssyntax sind noch nicht enthalten.
- Türkisch und Kurmancî übersetzen die wichtigsten Nutzertexte und greifen für noch nicht übersetzte Schlüssel kontrolliert auf Deutsch zurück.
- Detailwerte von Flood-/Warnschutz und Begrüßungstext sind vollständig im Datenmodell konfigurierbar; eine interaktive Admin-Befehlssyntax dafür ist in V1 noch nicht enthalten.
