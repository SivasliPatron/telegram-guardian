export type Locale = 'de' | 'tr' | 'ku';

const de = {
  error_generic: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.',
  error_group_only: 'Dieser Befehl funktioniert nur in einer Gruppe.',
  error_admin_only: 'Dafür benötigst du Administratorrechte.',
  error_moderator_only: 'Dafür benötigst du Moderatorenrechte.',
  error_bot_permissions: 'Dem Bot fehlt die Berechtigung, Mitglieder einzuschränken.',
  error_protected_target: 'Administratoren und Eigentümer dürfen nicht moderiert werden.',
  error_target:
    'Antworte auf eine Nachricht oder gib einen @Benutzernamen bzw. eine numerische Telegram-ID an. Der Nutzer muss dem Bot bereits in der Gruppe bekannt sein.',
  error_duration: 'Ungültige Zeitangabe. Erlaubt sind z. B. 10m, 2h, 3d oder 1w.',
  error_reason: 'Bitte gib einen Grund an.',
  rules_title: '📜 <b>Gruppenregeln</b>',
  rules_saved: 'Die Gruppenregeln wurden gespeichert.',
  welcome_rules_button: '📜 Regeln',
  warning_added: '⚠️ {user} wurde verwarnt ({count}/{max}). Grund: {reason}',
  warnings_title: '⚠️ Verwarnungen für {user}: {count}',
  warning_removed: 'Die letzte aktive Verwarnung wurde entfernt.',
  warnings_cleared: 'Alle aktiven Verwarnungen wurden entfernt.',
  no_warnings: 'Keine aktiven Verwarnungen gefunden.',
  muted: '🔇 {user} wurde für {duration} stummgeschaltet. Grund: {reason}',
  unmuted: '🔊 {user} kann wieder schreiben.',
  banned: '⛔ {user} wurde gesperrt. Grund: {reason}',
  temp_banned: '⛔ {user} wurde für {duration} gesperrt. Grund: {reason}',
  unbanned: '✅ Die Sperre für {user} wurde aufgehoben.',
  kicked: '👢 {user} wurde aus der Gruppe entfernt.',
  flood_action: 'Zu viele Nachrichten: {user} wurde vorübergehend stummgeschaltet.',
  link_deleted: 'Nicht erlaubte Werbung oder Kontaktdaten wurden entfernt.',
  antilink_status:
    'Linkschutz: {status}\nVerwendung: <code>/antilink on</code> oder <code>/antilink off</code>',
  setting_saved: 'Einstellung gespeichert.',
  domain_added: 'Die Domain wurde zur Ausnahmeliste hinzugefügt.',
  domain_removed: 'Die Domain wurde aus der Ausnahmeliste entfernt.',
  night_status: 'Nachtmodus: {enabled}\nSchließen: {close}\nÖffnen: {open}\nZeitzone: {timezone}',
  night_enabled: 'aktiv',
  night_disabled: 'inaktiv',
  log_channel_saved: 'Der Admin-Log-Kanal wurde erfolgreich eingerichtet.',
  privacy_data:
    'Gespeichert: Telegram-ID, öffentlicher Profilname, Gruppenrolle, Beitritts-/Aktivitätszeit und Moderationshistorie. Es werden keine Nachrichteninhalte dauerhaft gespeichert.',
  privacy_deleted:
    'Entfernbare Profildaten wurden anonymisiert. Sicherheitsrelevante Moderationshistorie bleibt mit minimaler Telegram-ID-Zuordnung erhalten.',
  userinfo:
    '<b>{name}</b>\nTelegram-ID: <code>{id}</code>\nRolle: {role}\nBeitritt: {joined}\nWarnungen: {warnings}\nMute bis: {muted}\nModerationsaktionen: {actions}\n\n<b>Letzte Aktionen</b>\n{history}',
  help_title: '🤖 <b>Verfügbare Befehle</b>',
  filter_added: 'Filter wurde hinzugefügt.',
  filter_removed: 'Filter wurde entfernt.',
  filter_invalid: 'Der Filter ist ungültig oder der reguläre Ausdruck ist potenziell gefährlich.',
  custom_command_added: 'Benutzerdefinierter Befehl wurde gespeichert.',
  custom_command_removed: 'Benutzerdefinierter Befehl wurde entfernt.',
} as const;

type TranslationKey = keyof typeof de;

const tr: Partial<Record<TranslationKey, string>> = {
  error_generic: 'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
  error_admin_only: 'Bunun için yönetici yetkisi gerekiyor.',
  error_moderator_only: 'Bunun için moderatör yetkisi gerekiyor.',
  rules_title: '📜 <b>Grup kuralları</b>',
  welcome_rules_button: '📜 Kurallar',
  help_title: '🤖 <b>Kullanılabilir komutlar</b>',
  setting_saved: 'Ayar kaydedildi.',
};

const ku: Partial<Record<TranslationKey, string>> = {
  error_generic: 'Çewtiyek nediyar çêbû. Ji kerema xwe paşê dîsa biceribîne.',
  error_admin_only: 'Ji bo vê yekê destûra rêveberiyê pêwîst e.',
  error_moderator_only: 'Ji bo vê yekê destûra moderatoriyê pêwîst e.',
  rules_title: '📜 <b>Rêzikên komê</b>',
  welcome_rules_button: '📜 Rêzik',
  help_title: '🤖 <b>Fermanên berdest</b>',
  setting_saved: 'Mîheng hate tomarkirin.',
};

const dictionaries: Record<Locale, Partial<Record<TranslationKey, string>>> = { de, tr, ku };

export function normalizeLocale(locale: string): Locale {
  if (locale === 'tr' || locale === 'ku') return locale;
  return 'de';
}

export function translate(
  locale: string,
  key: TranslationKey,
  parameters: Readonly<Record<string, string | number>> = {},
): string {
  const template = dictionaries[normalizeLocale(locale)][key] ?? de[key];
  return Object.entries(parameters).reduce(
    (result, [parameter, value]) => result.replaceAll(`{${parameter}}`, String(value)),
    template,
  );
}

export type { TranslationKey };
