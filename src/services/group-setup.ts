import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';
import { setPresetFilters } from '../modules/filters/presets.js';
import { setDisplayNamePresets } from '../modules/name-guard/presets.js';

export const DEFAULT_GROUP_RULES = `1. Respektvoller Umgang
Behandle alle Mitglieder höflich. Beleidigungen, persönliche Angriffe, Mobbing und Provokationen sind nicht erlaubt – unabhängig davon, ob sie auf Deutsch, Türkisch oder Kurmancî geschrieben werden.

2. Religion und Zusammenleben
Islamische Heiligtümer, Allah, der Koran und die Propheten dürfen nicht beschimpft oder vulgär verunglimpft werden. Sachliche Fragen, respektvolle Diskussionen und unterschiedliche Meinungen bleiben erlaubt.

3. Kein Hass
Rassismus, Antisemitismus sowie Hass gegen Religionen, Ethnien, Nationalitäten oder andere Personengruppen sind verboten.

4. Kein Spam und keine unerlaubte Werbung
Keine wiederholten Nachrichten, Einladungslinks, Fremdwerbung oder ungefragten Kontaktdaten. Erlaubte Links bestimmt das Admin-Team.

5. Jugendschutz und Sicherheit
Keine pornografischen, gewaltverherrlichenden oder illegalen Inhalte. Keine Drohungen und keine Aufrufe zu Gewalt.

6. Privatsphäre
Veröffentliche keine privaten Daten, Bilder oder Chatverläufe anderer Personen ohne deren Zustimmung.

7. Moderation
Anweisungen des Admin-Teams sind zu beachten. Regelverstöße können zur Löschung der Nachricht, Verwarnung, Stummschaltung oder Sperre führen. Nach drei aktiven Verwarnungen erfolgt automatisch eine zeitlich begrenzte Stummschaltung.

8. Gemeinschaft
Diese Gruppe steht für respektvolles kurdisch-türkisches Zusammenleben. Kritik ist erlaubt, gezielte Feindseligkeit und Hetze nicht.`;

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
