import { ModerationActionType } from '../generated/prisma/enums.js';
import type { Dependencies } from '../types/dependencies.js';
import type { GroupReference } from '../types/context.js';

export interface WarningBanTarget {
  group: GroupReference;
  targetUserId: string;
  targetTelegramId: bigint;
  moderatorUserId?: string;
  warningCount: number;
}

export function shouldApplyWarningBan(warningCount: number, maximumWarnings: number): boolean {
  return maximumWarnings > 0 && warningCount >= maximumWarnings;
}

export async function banAfterWarningThreshold(
  dependencies: Dependencies,
  target: WarningBanTarget,
): Promise<void> {
  const reason = `Automatisch nach ${target.warningCount} aktiven Verwarnungen`;
  await dependencies.bot.api.banChatMember(
    target.group.telegramId.toString(),
    Number(target.targetTelegramId),
    { revoke_messages: true },
  );
  await dependencies.database.$transaction([
    dependencies.database.moderationAction.create({
      data: {
        groupId: target.group.id,
        targetUserId: target.targetUserId,
        ...(target.moderatorUserId ? { moderatorId: target.moderatorUserId } : {}),
        type: ModerationActionType.BAN,
        reason,
        metadata: { automaticWarningBan: true, warningCount: target.warningCount },
      },
    }),
    dependencies.database.groupMember.updateMany({
      where: { groupId: target.group.id, userId: target.targetUserId },
      data: { mutedUntil: null, deletedAt: new Date() },
    }),
  ]);
  await dependencies.adminLog.send(target.group.id, 'Automatischer Ban', {
    Nutzer: target.targetTelegramId.toString(),
    Verwarnungen: target.warningCount,
    Grund: reason,
  });
}
