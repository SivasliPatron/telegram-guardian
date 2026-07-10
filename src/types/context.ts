import { Context } from 'grammy';

export interface GroupReference {
  id: string;
  telegramId: bigint;
  title: string;
}

export class BotContext extends Context {
  public group: GroupReference | undefined;
  public locale = 'de';
}
