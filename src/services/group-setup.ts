import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';
import { setPresetFilters } from '../modules/filters/presets.js';
import { allowedNameCacheKey, forbiddenNameCacheKey } from './name-guard.js';

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

8. Politische Grenzen
Verboten sind politische Propaganda, Rekrutierung, Verherrlichung, Führerkult sowie organisations- oder führerbezogene Parolen. Ebenso verboten sind politischer Hass, Drohungen und Aufrufe zu Gewalt. Bezüge zu Organisationen und Akteuren wie PKK, Apo beziehungsweise Abdullah Öcalan, Erdoğan oder Bozkurt werden besonders streng geprüft.
Neutrale Angaben zu Ländern, Regionen, Herkunft, Reisen, Geografie, Sprachen und Kultur bleiben erlaubt. Dazu gehören einzelne Begriffe wie „Kurdistan“ oder „Türkei“, neutrale Reisesätze sowie allgemeine Aussagen wie „Free Kurdistan“ und „Free Türkei“, solange sie nicht mit verbotenen Organisationen oder Führungspersonen, Propaganda, Hass, Drohungen oder Gewalt verbunden werden.

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
  await setPresetFilters(database, groupId, actorTelegramId, true);
  await redis.del(
    `settings:${groupId}`,
    `filters:${groupId}`,
    forbiddenNameCacheKey(groupId),
    allowedNameCacheKey(groupId),
  );
}
