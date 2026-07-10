import { InternalRole } from '../generated/prisma/enums.js';

export interface CommandDefinition {
  command: string;
  description: string;
  role: InternalRole;
  category: 'Mitglieder' | 'Moderatoren' | 'Administratoren' | 'Eigentümer';
}

export const commandRegistry: readonly CommandDefinition[] = [
  {
    command: 'help',
    description: 'Verfügbare Befehle',
    role: InternalRole.MEMBER,
    category: 'Mitglieder',
  },
  {
    command: 'rules',
    description: 'Gruppenregeln anzeigen',
    role: InternalRole.MEMBER,
    category: 'Mitglieder',
  },
  {
    command: 'regeln',
    description: 'Gruppenregeln anzeigen',
    role: InternalRole.MEMBER,
    category: 'Mitglieder',
  },
  {
    command: 'userinfo',
    description: 'Benutzerinformationen',
    role: InternalRole.MEMBER,
    category: 'Mitglieder',
  },
  {
    command: 'mydata',
    description: 'Gespeicherte eigene Daten',
    role: InternalRole.MEMBER,
    category: 'Mitglieder',
  },
  {
    command: 'deletemydata',
    description: 'Entfernbare Daten löschen',
    role: InternalRole.MEMBER,
    category: 'Mitglieder',
  },
  {
    command: 'warnings',
    description: 'Verwarnungen anzeigen',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'warn',
    description: 'Nutzer verwarnen',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'unwarn',
    description: 'Letzte Warnung entfernen',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'mute',
    description: 'Nutzer stummschalten',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'tmute',
    description: 'Zeitlich stummschalten',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'unmute',
    description: 'Stummschaltung aufheben',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'ban',
    description: 'Nutzer sperren',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'tban',
    description: 'Zeitlich sperren',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'unban',
    description: 'Sperre aufheben',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'kick',
    description: 'Nutzer entfernen',
    role: InternalRole.MODERATOR,
    category: 'Moderatoren',
  },
  {
    command: 'setrules',
    description: 'Regeln festlegen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'antilink',
    description: 'Linkschutz konfigurieren',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'nightmode',
    description: 'Nachtmodus konfigurieren',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'nightstatus',
    description: 'Nachtmodus anzeigen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'setlogchannel',
    description: 'Admin-Log-Kanal festlegen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'addfilter',
    description: 'Wortfilter erstellen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'filters',
    description: 'Wortfilter anzeigen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'promotemod',
    description: 'Moderator ernennen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'trust',
    description: 'Nutzer vertrauen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'clearwarnings',
    description: 'Warnungen löschen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'addcommand',
    description: 'Eigenen Befehl anlegen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'commands',
    description: 'Eigene Befehle anzeigen',
    role: InternalRole.ADMIN,
    category: 'Administratoren',
  },
  {
    command: 'demotemod',
    description: 'Moderator zurückstufen',
    role: InternalRole.OWNER,
    category: 'Eigentümer',
  },
] as const;
