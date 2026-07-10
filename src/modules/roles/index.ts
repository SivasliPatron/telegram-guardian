import { InternalRole } from '../../generated/prisma/enums.js';
import type { Dependencies } from '../../types/dependencies.js';
import { findOrCreateUserByTelegramId, ensureUser } from '../../database/repositories.js';
import { commandArguments } from '../../utils/telegram.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';
import type { BotContext } from '../../types/context.js';

export function registerRolesModule(dependencies: Dependencies): void {
  const changeModeratorRole = async (ctx: BotContext, role: InternalRole, requireOwner = false) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    if (requireOwner) {
      const actual = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
      if (actual !== InternalRole.OWNER) throw new UserFacingError('error_owner_only');
    } else {
      await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    }
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    const user = await findOrCreateUserByTelegramId(dependencies.database, target.telegramId);
    const trusted =
      role === InternalRole.MEMBER
        ? await dependencies.database.trustedUser.findUnique({
            where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
          })
        : null;
    const nextRole = trusted ? InternalRole.TRUSTED : role;
    await dependencies.database.groupMember.upsert({
      where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
      create: { groupId: ctx.group.id, userId: user.id, role: nextRole },
      update: { role: nextRole },
    });
    await dependencies.redis.del(`role:${ctx.group.id}:${target.telegramId}`);
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  };

  const setTrusted = async (ctx: BotContext, trusted: boolean) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    const [user, grantor] = await Promise.all([
      findOrCreateUserByTelegramId(dependencies.database, target.telegramId),
      ensureUser(dependencies.database, ctx.from),
    ]);
    if (trusted) {
      const member = await dependencies.database.groupMember.findUnique({
        where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
        select: { role: true },
      });
      const role =
        member?.role === InternalRole.MODERATOR ||
        member?.role === InternalRole.ADMIN ||
        member?.role === InternalRole.OWNER
          ? member.role
          : InternalRole.TRUSTED;
      await dependencies.database.$transaction([
        dependencies.database.trustedUser.upsert({
          where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
          create: { groupId: ctx.group.id, userId: user.id, grantedById: grantor.id },
          update: { grantedById: grantor.id },
        }),
        dependencies.database.groupMember.upsert({
          where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
          create: { groupId: ctx.group.id, userId: user.id, role },
          update: { role },
        }),
      ]);
    } else {
      await dependencies.database.$transaction([
        dependencies.database.trustedUser.deleteMany({
          where: { groupId: ctx.group.id, userId: user.id },
        }),
        dependencies.database.groupMember.updateMany({
          where: { groupId: ctx.group.id, userId: user.id, role: InternalRole.TRUSTED },
          data: { role: InternalRole.MEMBER },
        }),
      ]);
    }
    await dependencies.redis.del(`role:${ctx.group.id}:${target.telegramId}`);
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  };

  dependencies.bot.command('promotemod', (ctx) => changeModeratorRole(ctx, InternalRole.MODERATOR));
  dependencies.bot.command('demotemod', (ctx) =>
    changeModeratorRole(ctx, InternalRole.MEMBER, true),
  );
  dependencies.bot.command(['trust', 'allowuser'], (ctx) => setTrusted(ctx, true));
  dependencies.bot.command(['untrust', 'removealloweduser'], (ctx) => setTrusted(ctx, false));
}
