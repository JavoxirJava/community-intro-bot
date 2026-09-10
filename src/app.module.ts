import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BotModule } from './bot/bot.module';
import { EventsModule } from './events/events.module';
import { GroupsModule } from './groups/groups.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { VacanciesModule } from './vacancies/vacancies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (config: Record<string, unknown>) => {
        if (!config.BOT_TOKEN) throw new Error('BOT_TOKEN is required');
        if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required');
        config.APP_TIMEZONE ??= 'Asia/Tashkent';
        const domain = String(config.WEBHOOK_DOMAIN ?? '').trim();
        const secret = String(config.WEBHOOK_SECRET ?? '').trim();
        if (domain && secret.length < 16) {
          throw new Error('WEBHOOK_DOMAIN bilan WEBHOOK_SECRET (kamida 16 belgi) shart');
        }
        return config;
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    ProfilesModule,
    GroupsModule,
    SearchModule,
    EventsModule,
    VacanciesModule,
    BotModule,
  ],
})
export class AppModule {}
