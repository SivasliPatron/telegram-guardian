import type { Api } from 'grammy';
import type { Logger } from 'pino';
import type { Database } from '../database/client.js';
import { escapeHtml } from '../utils/telegram.js';

export class AdminLogService {
  public constructor(
    private readonly database: Database,
    private readonly api: Api,
    private readonly logger: Logger,
  ) {}

  public async send(
    groupId: string,
    title: string,
    details: Readonly<Record<string, string | number>>,
  ) {
    const configuration = await this.database.adminLogConfiguration.findUnique({
      where: { groupId },
    });
    if (!configuration?.enabled) return;
    const lines = Object.entries(details).map(
      ([key, value]) => `<b>${escapeHtml(key)}:</b> ${escapeHtml(String(value))}`,
    );
    try {
      await this.api.sendMessage(
        configuration.channelTelegramId.toString(),
        `<b>${escapeHtml(title)}</b>\n${lines.join('\n')}`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      this.logger.warn({ err: error, groupId }, 'Admin-Log konnte nicht gesendet werden');
    }
  }
}
