export type Locale = 'de' | 'tr' | 'ku';

const de = {
  error_generic: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.',
  error_group_only: 'Dieser Befehl funktioniert nur in einer Gruppe.',
  error_admin_only: 'Dafür benötigst du Administratorrechte.',
  error_owner_only: 'Dafür musst du der Gruppeneigentümer sein.',
  error_moderator_only: 'Dafür benötigst du Moderatorenrechte.',
  error_bot_permissions: 'Dem Bot fehlt die Berechtigung, Mitglieder einzuschränken.',
  error_bot_invite_permissions:
    'Dem Bot fehlt die Admin-Berechtigung „Nutzer hinzufügen“, die für Beitrittsanfragen benötigt wird.',
  error_protected_target: 'Administratoren und Eigentümer dürfen nicht moderiert werden.',
  error_target: 'Bitte gib einen @Benutzernamen an.',
  error_duration: 'Ungültige Zeitangabe. Erlaubt sind z. B. 10m, 2h, 3d oder 1w.',
  error_reason: 'Bitte gib einen Grund an.',
  error_clock:
    'Ungültige Uhrzeit. Verwende /setclosetime HH:MM oder /setopentime HH:MM, z. B. 00:00.',
  error_domain: 'Bitte gib eine gültige Domain an, z. B. /allowdomain beispiel.de.',
  error_setrules: 'Verwendung: /setrules Dein Regeltext',
  error_log_channel: 'Verwendung: /setlogchannel -1001234567890',
  error_custom_command: 'Verwendung: /addcommand befehl Antworttext',
  error_remove_command: 'Verwendung: /removecommand befehl',
  error_remove_filter: 'Verwendung: /removefilter FILTER-ID',
  error_schedule_message:
    'Verwendung: /schedulemessage HH:MM WOCHENTAGE TEXT, z. B. /schedulemessage 18:30 1,2,3 Erinnerung',
  error_delete_scheduled_message: 'Verwendung: /deletescheduledmessage NACHRICHTEN-ID',
  error_forbidden_name:
    'Verwendung: /addforbiddenname NAME. Der Eintrag muss mindestens 3 Buchstaben oder Zahlen enthalten.',
  error_remove_forbidden_name: 'Verwendung: /removeforbiddenname EINTRAGS-ID',
  error_inactivity_usage: 'Verwendung: /inaktiv, /inaktiv status, /inaktiv an oder /inaktiv aus',
  error_name_guard_empty: 'Füge zuerst mindestens einen Eintrag mit /addforbiddenname NAME hinzu.',
  rules_title: '📜 <b>Gruppenregeln</b>',
  rules_saved: 'Die Gruppenregeln wurden gespeichert.',
  setup_complete:
    '✅ Die professionellen Gruppenregeln und die mehrsprachigen Schutzfilter wurden eingerichtet.',
  name_guard_status:
    'Namensschutz: {status}\nBestätigte Sperrfilter: {count}\nNamensfreigaben: {allowed}\nVerwendung: /nameguard on oder /nameguard off',
  name_guard_removed: '🚫 <b>{name}</b> wird entfernt. {message}',
  name_guard_private_notice:
    '{message}\n\nGeprüft wird nur dein sichtbarer Vor- und Nachname, nicht dein @Benutzername. Ändere deinen sichtbaren Namen; danach kannst du erneut beitreten.',
  forbidden_name_added: 'Der verbotene Name „{pattern}“ wurde gespeichert.',
  forbidden_name_removed: 'Der verbotene Name wurde entfernt.',
  forbidden_name_not_found: 'Dieser verbotene Namenseintrag wurde nicht gefunden.',
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
  welcome_status: 'Begrüßung: {status}\nVerwendung: /welcome on oder /welcome off',
  setting_saved: 'Einstellung gespeichert.',
  domain_added: 'Die Domain wurde zur Ausnahmeliste hinzugefügt.',
  domain_removed: 'Die Domain wurde aus der Ausnahmeliste entfernt.',
  domain_not_found: 'Diese Domain steht nicht auf der Ausnahmeliste.',
  night_status: 'Nachtmodus: {enabled}\nSchließen: {close}\nÖffnen: {open}\nZeitzone: {timezone}',
  nightmode_status: 'Nachtmodus: {status}\nVerwendung: /nightmode on oder /nightmode off',
  night_enabled: 'aktiv',
  night_disabled: 'inaktiv',
  inactivity_tracking_not_started: 'noch nicht gestartet',
  inactivity_status:
    '🧹 <b>Inaktivitätsbereinigung</b>\nStatus: <b>{status}</b>\nBekannte Mitglieder: {known}\nTrackingbeginn: {started}\n\nNach 7 Tagen ohne Gruppenbeitrag werden bekannte Mitglieder in der Gruppe markiert. Bleiben sie weitere 24 Stunden inaktiv, werden sie entfernt und können später erneut beitreten.\n\nAusgenommen sind Gruppeneigentümer, Telegram-Admins, interne Admins und Moderatoren, vertrauenswürdige Mitglieder sowie Bots. Telegram stellt dem Bot keine vollständige Mitgliederliste bereit; geprüft werden nur dem Bot bekannte Personen.\n\nHinweis: Beim technischen Kick löscht Telegram in Supergruppen auch die bisherigen Nachrichten der entfernten Person.\n\nVerwendung: <code>/inaktiv an</code> oder <code>/inaktiv aus</code>',
  inactivity_enabled:
    '✅ Die Inaktivitätsbereinigung ist aktiv. Die sichere Beobachtungsphase beginnt jetzt: erste Markierungen frühestens nach 7 Tagen, Entfernungen frühestens weitere 24 Stunden später.',
  inactivity_already_enabled:
    'ℹ️ Die Inaktivitätsbereinigung ist bereits aktiv. Der bestehende Trackingbeginn wurde nicht zurückgesetzt.',
  inactivity_disabled:
    '⏸ Die Inaktivitätsbereinigung ist ausgeschaltet. Offene Hinweise wurden für noch nicht entfernte Mitglieder abgebrochen; bereits begonnene Entfernungen werden sicher abgeschlossen.',
  log_channel_saved: 'Der Admin-Log-Kanal wurde erfolgreich eingerichtet.',
  privacy_data:
    'Gespeichert: Telegram-ID, öffentlicher Profilname, Gruppenrolle, Beitritts-/Aktivitätszeit, vorübergehende Inaktivitätsfristen und Moderationshistorie. Für die Inaktivitätsprüfung wird kein Nachrichteninhalt gespeichert. Potenziell kritische Nachrichten und Namensentscheidungen bleiben höchstens 24 Stunden offen. Bestätigte Nachrichten- und Namensfilter sowie ausdrücklich erlaubte sichtbare Namen bleiben gespeichert, bis ein Admin sie entfernt.',
  privacy_deleted:
    'Entfernbare Profildaten wurden anonymisiert. Sicherheitsrelevante Moderationshistorie bleibt mit minimaler Telegram-ID-Zuordnung erhalten.',
  userinfo:
    '<b>{name}</b>\nTelegram-ID: <code>{id}</code>\nRolle: {role}\nBeitritt: {joined}\nWarnungen: {warnings}\nMute bis: {muted}\nModerationsaktionen: {actions}\n\n<b>Letzte Aktionen</b>\n{history}',
  help_title: '🤖 <b>Verfügbare Befehle</b>',
  ai_chat_usage: 'Verwendung: /ki Deine Frage',
  ai_chat_too_long: 'Die Frage ist zu lang. Bitte verwende höchstens 1.500 Zeichen.',
  ai_chat_unavailable: 'Die KI-Funktion ist momentan nicht eingerichtet.',
  ai_chat_rate_limited: 'Bitte warte kurz. Pro Person sind fünf KI-Fragen pro Minute erlaubt.',
  ai_chat_failed: 'Die KI konnte gerade nicht antworten. Bitte versuche es später erneut.',
  member_command_cooldown:
    '⏳ Du hast bereits drei Befehle benutzt. Warte noch etwa {duration}. /ki kannst du weiterhin benutzen.',
  filter_added: 'Filter wurde hinzugefügt.',
  filter_removed: 'Filter wurde entfernt.',
  preset_filter_status:
    'Mehrsprachige Standardfilter: {status}\nVerwendung: /presetfilters on oder /presetfilters off',
  filter_invalid:
    'Ungültiger Filter. Beispiel: /addfilter contains delete spam. Aktionen: delete, warn, mute, log, reply.',
  filter_not_found: 'Dieser Filter wurde nicht gefunden.',
  automatic_filter_warning:
    '⚠️ <b>{user}</b> wurde automatisch verwarnt ({count}/{max}). Grund: {reason}',
  automatic_filter_muted:
    '🔇 <b>{user}</b> wurde nach Erreichen der Warnungsgrenze für {duration} stummgeschaltet.',
  automatic_warning_banned:
    '⛔ <b>{user}</b> wurde nach {count} aktiven Verwarnungen dauerhaft aus der Gruppe gebannt.',
  custom_command_added: 'Benutzerdefinierter Befehl wurde gespeichert.',
  custom_command_removed: 'Benutzerdefinierter Befehl wurde entfernt.',
  custom_command_not_found: 'Dieser benutzerdefinierte Befehl wurde nicht gefunden.',
  scheduled_message_not_found: 'Diese geplante Nachricht wurde nicht gefunden.',
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
