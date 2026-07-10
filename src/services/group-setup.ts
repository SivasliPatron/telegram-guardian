import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';
import { setPresetFilters } from '../modules/filters/presets.js';
import { setDisplayNamePresets } from '../modules/name-guard/presets.js';

export const DEFAULT_GROUP_RULES = `1. Respektvoller Umgang
Behandle alle Mitglieder höflich. Beleidigungen, persönliche Angriffe, Mobbing und Provokationen sind nicht erlaubt – unabhängig davon, ob sie auf Deutsch, Türkisch oder Kurmancî geschrieben werden.

2. Religion und Zusammenleben
Alle Religionen, Glaubensgemeinschaften, heiligen Schriften, Heiligtümer, Propheten, religiösen Persönlichkeiten und religiösen Symbole sind respektvoll zu behandeln. Beschimpfungen, Verhöhnung, vulgäre Verunglimpfung und gezielte religiöse Provokationen sind verboten. Sachliche religiöse Gespräche bleiben erlaubt, solange sie respektvoll geführt werden.

3. Kein Hass
Rassismus, Antisemitismus sowie Hass gegen Religionen, Ethnien, Nationalitäten oder andere Personengruppen sind verboten.

4. Kein Spam und keine unerlaubte Werbung
Keine wiederholten Nachrichten, Einladungslinks, Fremdwerbung oder ungefragten Kontaktdaten. Erlaubte Links bestimmt das Admin-Team.

5. Jugendschutz und Sicherheit
Keine pornografischen, gewaltverherrlichenden oder illegalen Inhalte. Keine Drohungen und keine Aufrufe zu Gewalt.

6. Privatsphäre
Veröffentliche keine privaten Daten, Bilder oder Chatverläufe anderer Personen ohne deren Zustimmung.

7. Keine unerlaubten Privatnachrichten
Kein Mitglied darf eine andere Person aus der Gruppe per DM oder Privatnachricht kontaktieren, bevor diese Person dafür ausdrücklich im Gruppenchat ihre Erlaubnis erteilt hat. Nach einer nachvollziehbaren Meldung mit Beleg wird ein Verstoß ohne vorherige Verwarnung sofort mit dem Ausschluss aus der Gruppe geahndet.

8. Absolutes Politikverbot
Politische Inhalte jeder Art sind verboten – unabhängig von politischer Richtung, Partei, Person, Organisation, Land, Anlass oder Absicht. Dazu gehören politische Diskussionen, Lob, Kritik, Wahlwerbung, Propaganda, Parolen, Symbole und Provokationen.

9. Moderation
Anweisungen des Admin-Teams sind zu beachten. Regelverstöße können zur Löschung der Nachricht, Verwarnung, Stummschaltung oder Sperre führen. Ab der dritten aktiven Verwarnung erfolgt automatisch ein dauerhafter Ban aus der Gruppe. Verstöße gegen das Verbot unerlaubter Privatnachrichten führen unmittelbar zum Ausschluss ohne vorherige Verwarnung.`;

export async function applyRecommendedGroupSetup(
  database: Database,
  redis: RedisClient,
  groupId: string,
  actorTelegramId: bigint,
): Promise<void> {
  await database.groupSettings.update({
    where: { groupId },
    data: { rulesText: DEFAULT_GROUP_RULES, nameProtectionEnabled: true },
  });
  await Promise.all([
    setPresetFilters(database, groupId, actorTelegramId, true),
    setDisplayNamePresets(database, redis, groupId, actorTelegramId),
  ]);
  await redis.del(`settings:${groupId}`, `filters:${groupId}`, `forbidden-names:${groupId}`);
}
