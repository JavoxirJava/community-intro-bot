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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (config: Record<string, unknown>) => {
        if (!config.BOT_TOKEN) throw new Error('BOT_TOKEN is required');
        if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required');
        config.APP_TIMEZONE ??= 'Asia/Tashkent';
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
    BotModule,
  ],
})
export class AppModule {}
