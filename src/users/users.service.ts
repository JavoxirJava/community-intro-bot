import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { User as TelegramUser } from 'telegraf/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  upsertTelegramUser(user: TelegramUser): Promise<User> {
    return this.prisma.user.upsert({
      where: { telegramId: BigInt(user.id) },
      create: {
        telegramId: BigInt(user.id),
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        languageCode: user.language_code,
      },
      update: {
        username: user.username ?? null,
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        languageCode: user.language_code ?? null,
        isActive: true,
      },
    });
  }

  findByTelegramId(telegramId: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  }
}
