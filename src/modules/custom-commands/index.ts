import type { Dependencies } from '../../types/dependencies.js';
import { commandArguments, commandRemainder } from '../../utils/telegram.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';
import { commandRegistry } from '../../commands/registry.js';

const COMMAND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u;
const RESERVED_COMMANDS = new Set(commandRegistry.map(({ command }) => command));

export function registerCustomCommandsModule(dependencies: Dependencies): void {
  dependencies.bot.command('addcommand', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const command = (commandArguments(ctx)[0] ?? '').replace(/^\//, '').toLowerCase();
    const response = commandRemainder(ctx, 1);
    if (!COMMAND_PATTERN.test(command) || RESERVED_COMMANDS.has(command) || !response) {
      throw new UserFacingError('error_custom_command');
    }
    await dependencies.database.customCommand.upsert({
      where: { groupId_command: { groupId: ctx.group.id, command } },
      create: {
        groupId: ctx.group.id,
        command,
        responseText: response,
        createdByTelegramId: BigInt(ctx.from.id),
      },
      update: { responseText: response, enabled: true, deletedAt: null },
    });
    await ctx.reply(translate(ctx.locale, 'custom_command_added'));
  });

  dependencies.bot.command('removecommand', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const command = (commandArguments(ctx)[0] ?? '').replace(/^\//, '').toLowerCase();
    if (!COMMAND_PATTERN.test(command) || RESERVED_COMMANDS.has(command)) {
      throw new UserFacingError('error_remove_command');
    }
    const result = await dependencies.database.customCommand.updateMany({
      where: { groupId: ctx.group.id, command },
      data: { enabled: false, deletedAt: new Date() },
    });
    if (result.count === 0) throw new UserFacingError('custom_command_not_found');
    await ctx.reply(translate(ctx.locale, 'custom_command_removed'));
  });

  dependencies.bot.command('commands', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const commands = await dependencies.database.customCommand.findMany({
      where: { groupId: ctx.group.id, enabled: true, deletedAt: null },
      select: { command: true },
      orderBy: { command: 'asc' },
    });
    await ctx.reply(commands.map(({ command }) => `/${command}`).join('\n') || '–');
  });

  dependencies.bot.on('message:text', async (ctx, next) => {
    if (!ctx.group || !ctx.message.text.startsWith('/')) {
      await next();
      return;
    }
    const command = ctx.message.text.slice(1).split(/[\s@]/u)[0]?.toLowerCase();
    if (!command) {
      await next();
      return;
    }
    const stored = await dependencies.database.customCommand.findUnique({
      where: { groupId_command: { groupId: ctx.group.id, command } },
    });
    if (!stored?.enabled || stored.deletedAt) {
      await next();
      return;
    }
    await ctx.reply(stored.responseText);
  });
}
