import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Event, EventStatus, Prisma, User } from '@prisma/client';
import { DateTime } from 'luxon';
import { escapeHtml, telegramMention } from '../common/utils/telegram-mention.util';
import { PrismaService } from '../prisma/prisma.service';

export interface EventInput {
  title: string;
  date: string;
  time: string;
  location: string;
  description?: string | null;
}

const eventInclude = {
  group: true,
  participants: {
    where: { isActive: true },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  },
} satisfies Prisma.EventInclude;

export type EventWithParticipants = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

@Injectable()
export class EventsService {
  readonly timezone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.timezone = config.get<string>('APP_TIMEZONE', 'Asia/Tashkent');
  }

  parseStart(date: string, time: string): Date {
    const normalizedDate = date.trim();
    const format = /^\d{2}\.\d{2}\.\d{4}$/.test(normalizedDate)
      ? 'dd.MM.yyyy HH:mm'
      : 'yyyy-MM-dd HH:mm';
    const parsed = DateTime.fromFormat(`${normalizedDate} ${time.trim()}`, format, {
      zone: this.timezone,
    });
    if (!parsed.isValid || parsed <= DateTime.now().setZone(this.timezone)) {
      throw new BadRequestException(
        'Sana va vaqt noto‘g‘ri yoki o‘tib ketgan. Masalan: 31.12.2026 va 18:30.',
      );
    }
    return parsed.toUTC().toJSDate();
  }

  async create(groupId: string, creatorId: string, input: EventInput): Promise<Event> {
    const title = input.title.trim();
    const location = input.location.trim();
    if (!title || title.length > 150) {
      throw new BadRequestException('Tadbir nomi 1–150 belgi bo‘lishi kerak.');
    }
    if (!location || location.length > 250) {
      throw new BadRequestException('Joylashuv 1–250 belgi bo‘lishi kerak.');
    }
    if (input.description && input.description.length > 1000) {
      throw new BadRequestException('Tavsif 1000 belgidan oshmasligi kerak.');
    }

    return this.prisma.event.create({
      data: {
        groupId,
        creatorId,
        title,
        startsAt: this.parseStart(input.date, input.time),
        location,
        description: input.description?.trim() || null,
      },
    });
  }

  setMessageId(eventId: string, messageId: number): Promise<Event> {
    return this.prisma.event.update({
      where: { id: eventId },
      data: { telegramMessageId: BigInt(messageId) },
    });
  }

  async setParticipation(
    eventId: string,
    userId: string,
    active: boolean,
  ): Promise<EventWithParticipants | null> {
    const event = await this.prisma.event.findFirst({
      where: {
        id: eventId,
        status: EventStatus.ACTIVE,
        startsAt: { gt: new Date() },
        group: { isActive: true },
      },
      select: { id: true, groupId: true },
    });
    if (!event) return null;

    const membership = await this.prisma.groupMember.findFirst({
      where: {
        groupId: event.groupId,
        userId,
        isActive: true,
        group: { isActive: true },
      },
    });
    if (!membership) return null;

    await this.prisma.eventParticipant.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: {
        eventId,
        userId,
        isActive: active,
        ...(active ? {} : { leftAt: new Date() }),
      },
      update: {
        isActive: active,
        ...(active ? { joinedAt: new Date(), leftAt: null } : { leftAt: new Date() }),
      },
    });
    return this.get(eventId);
  }

  get(eventId: string): Promise<EventWithParticipants | null> {
    return this.prisma.event.findUnique({ where: { id: eventId }, include: eventInclude });
  }

  format(event: EventWithParticipants): string {
    const local = DateTime.fromJSDate(event.startsAt).setZone(this.timezone);
    const participantLines = event.participants
      .slice(0, 30)
      .map(({ user }, index) => `${index + 1}. ${telegramMention(user)}`);
    if (event.participants.length > 30) {
      participantLines.push(`…va yana ${event.participants.length - 30} kishi`);
    }

    return [
      `📅 <b>${escapeHtml(event.title)}</b>`,
      '',
      `<b>Sana:</b> ${local.toFormat('dd.MM.yyyy')}`,
      `<b>Vaqt:</b> ${local.toFormat('HH:mm')} (${escapeHtml(this.timezone)})`,
      `<b>Joy:</b> ${escapeHtml(event.location)}`,
      event.description ? `<b>Tavsif:</b> ${escapeHtml(event.description)}` : '',
      '',
      `<b>Ishtirokchilar (${event.participants.length}):</b>`,
      participantLines.length ? participantLines.join('\n') : 'Hozircha hech kim qo‘shilmagan.',
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  async dueForReminder(kind: 'twoHours' | 'thirtyMinutes'): Promise<EventWithParticipants[]> {
    const now = new Date();
    const upper = DateTime.fromJSDate(now)
      .plus({ minutes: kind === 'twoHours' ? 120 : 30 })
      .toJSDate();
    const lower =
      kind === 'twoHours' ? DateTime.fromJSDate(now).plus({ minutes: 30 }).toJSDate() : now;
    return this.prisma.event.findMany({
      where: {
        status: EventStatus.ACTIVE,
        group: { isActive: true },
        startsAt: { gt: lower, lte: upper },
        ...(kind === 'twoHours'
          ? { reminderTwoHoursSent: false }
          : { reminderThirtyMinSent: false }),
      },
      include: eventInclude,
    });
  }

  async claimReminder(eventId: string, kind: 'twoHours' | 'thirtyMinutes'): Promise<boolean> {
    const result = await this.prisma.event.updateMany({
      where: {
        id: eventId,
        ...(kind === 'twoHours'
          ? { reminderTwoHoursSent: false }
          : { reminderThirtyMinSent: false }),
      },
      data: kind === 'twoHours' ? { reminderTwoHoursSent: true } : { reminderThirtyMinSent: true },
    });
    return result.count === 1;
  }

  async releaseReminder(eventId: string, kind: 'twoHours' | 'thirtyMinutes'): Promise<void> {
    await this.prisma.event.update({
      where: { id: eventId },
      data:
        kind === 'twoHours' ? { reminderTwoHoursSent: false } : { reminderThirtyMinSent: false },
    });
  }

  activeParticipantUsers(event: EventWithParticipants): User[] {
    return event.participants.map(({ user }) => user).filter((user) => user.isActive);
  }
}
