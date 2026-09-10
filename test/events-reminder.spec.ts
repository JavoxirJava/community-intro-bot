import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventsService, ReminderKind } from '../src/events/events.service';

describe('EventsService reminder windows', () => {
  const now = new Date('2026-06-30T12:00:00.000Z');
  const findMany = jest.fn().mockResolvedValue([]);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    event: {
      findMany,
      updateMany,
    },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn().mockReturnValue('Asia/Tashkent'),
  } as unknown as ConfigService;
  const service = new EventsService(prisma, config);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['twoHours', 60, 120, 'reminderTwoHoursSent'],
    ['oneHour', 30, 60, 'reminderOneHourSent'],
    ['thirtyMinutes', 0, 30, 'reminderThirtyMinSent'],
    ['started', -10, 0, 'reminderStartedSent'],
  ] as const)(
    'uses a non-overlapping window for %s',
    async (kind, lowerMinutes, upperMinutes, flag) => {
      await service.dueForReminder(kind);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            startsAt: {
              gt: new Date(now.getTime() + lowerMinutes * 60_000),
              lte: new Date(now.getTime() + upperMinutes * 60_000),
            },
            [flag]: false,
          }),
        }),
      );
    },
  );

  it('claims the one-hour reminder only once', async () => {
    const kind: ReminderKind = 'oneHour';

    await expect(service.claimReminder('event-id', kind)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'event-id', reminderOneHourSent: false },
      data: { reminderOneHourSent: true },
    });
  });
});
