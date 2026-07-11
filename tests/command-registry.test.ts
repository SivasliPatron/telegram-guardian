import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandRegistry } from '../src/commands/registry.js';
import { InternalRole } from '../src/generated/prisma/enums.js';

const moduleFiles = [
  'src/modules/admin-log/index.ts',
  'src/modules/ai-chat/index.ts',
  'src/modules/custom-commands/index.ts',
  'src/modules/filters/index.ts',
  'src/modules/information/index.ts',
  'src/modules/inactivity/index.ts',
  'src/modules/moderation/index.ts',
  'src/modules/name-guard/index.ts',
  'src/modules/nightmode/index.ts',
  'src/modules/protection/index.ts',
  'src/modules/roles/index.ts',
  'src/modules/rules/index.ts',
  'src/modules/scheduled-messages/index.ts',
  'src/modules/welcome/index.ts',
] as const;

function registeredHandlerCommands(): string[] {
  const commands = new Set<string>();
  const callPattern = /dependencies\.bot\.command\(\s*(?:'([^']+)'|\[([^\]]+)\])/gu;
  for (const file of moduleFiles) {
    const source = readFileSync(resolve(file), 'utf8');
    for (const match of source.matchAll(callPattern)) {
      if (match[1]) commands.add(match[1]);
      for (const alias of match[2]?.matchAll(/'([^']+)'/gu) ?? []) {
        if (alias[1]) commands.add(alias[1]);
      }
    }
  }
  return [...commands].sort();
}

describe('zentrale Befehlsregistrierung', () => {
  it('enthält jeden registrierten Slash-Handler genau einmal', () => {
    const registryCommands = commandRegistry.map(({ command }) => command);
    expect(new Set(registryCommands).size).toBe(registryCommands.length);
    expect([...registryCommands].sort()).toEqual(registeredHandlerCommands());
  });

  it('ordnet lesbare Statusbefehle Mitgliedern zu', () => {
    const roles = new Map(commandRegistry.map(({ command, role }) => [command, role]));
    expect(roles.get('warnings')).toBe(InternalRole.MEMBER);
    expect(roles.get('nightstatus')).toBe(InternalRole.MEMBER);
    expect(roles.get('commands')).toBe(InternalRole.MEMBER);
    expect(roles.get('ki')).toBe(InternalRole.MEMBER);
    expect(roles.get('inaktiv')).toBe(InternalRole.ADMIN);
  });
});
