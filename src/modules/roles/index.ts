import { InternalRole } from '../../generated/prisma/enums.js';
import type { Dependencies } from '../../types/dependencies.js';
import { findOrCreateUserByTelegramId, ensureUser } from '../../database/repositories.js';
import { commandArguments } from '../../utils/telegram.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';
import type { BotContext } from '../../types/context.js';

export function registerRolesModule(dependencies: Dependencies): void {
  const changeRole = async (ctx: BotContext, role: InternalRole, requireOwner = false) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    if (requireOwner) {
      const actual = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
      if (actual !== InternalRole.OWNER) throw new UserFacingError('error_admin_only');
    } else {
      await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    }
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    const [user, grantor] = await Promise.all([
      findOrCreateUserByTelegramId(dependencies.database, target.telegramId),
      ensureUser(dependencies.database, ctx.from),
    ]);
    await dependencies.database.groupMember.upsert({
      where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
      create: { groupId: ctx.group.id, userId: user.id, role },
      update: { role },
    });
    if (role === InternalRole.TRUSTED) {
      await dependencies.database.trustedUser.upsert({
        where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
        create: { groupId: ctx.group.id, userId: user.id, grantedById: grantor.id },
        update: { grantedById: grantor.id },
      });
    } else {
      await dependencies.database.trustedUser.deleteMany({
        where: { groupId: ctx.group.id, userId: user.id },
      });
    }
    await dependencies.redis.del(`role:${ctx.group.id}:${target.telegramId}`);
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  };

  dependencies.bot.command('promotemod', (ctx) => changeRole(ctx, InternalRole.MODERATOR));
  dependencies.bot.command('demotemod', (ctx) => changeRole(ctx, InternalRole.MEMBER, true));
  dependencies.bot.command(['trust', 'allowuser'], (ctx) => changeRole(ctx, InternalRole.TRUSTED));
  dependencies.bot.command(['untrust', 'removealloweduser'], (ctx) =>
    changeRole(ctx, InternalRole.MEMBER),
  );
}
