import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { telegramMention } from '../common/utils/telegram-mention.util';
import { EventsService, EventWithParticipants } from './events.service';

@Injectable()
export class EventsScheduler {
  private readonly logger = new Logger(EventsScheduler.name);

  constructor(
    private readonly events: EventsService,
    @InjectBot() private readonly bot: Telegraf,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendReminders(): Promise<void> {
    await this.processKind('twoHours');
    await this.processKind('thirtyMinutes');
  }

  private async processKind(kind: 'twoHours' | 'thirtyMinutes'): Promise<void> {
    const dueEvents = await this.events.dueForReminder(kind);
    for (const event of dueEvents) {
      const claimed = await this.events.claimReminder(event.id, kind);
      if (!claimed) continue;
      try {
        await this.sendReminder(event, kind);
      } catch (error) {
        await this.events.releaseReminder(event.id, kind);
        this.logger.error(`Reminder failed for event ${event.id}`, error);
      }
    }
  }

  private async sendReminder(
    event: EventWithParticipants,
    kind: 'twoHours' | 'thirtyMinutes',
  ): Promise<void> {
    const participants = this.events.activeParticipantUsers(event);
    const mentions = participants.map(telegramMention).join(' ');
    const timeText = kind === 'twoHours' ? '2 soat' : '30 daqiqa';
    await this.bot.telegram.sendMessage(
      event.group.telegramId.toString(),
      [
        `⏰ <b>“${this.escape(event.title)}” tadbiriga ${timeText} qoldi.</b>`,
        mentions || 'Faol ishtirokchilar yo‘q.',
      ].join('\n\n'),
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    );
  }

  private escape(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }
}
