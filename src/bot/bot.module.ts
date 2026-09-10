import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InjectBot, TelegrafModule } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import {
  BOT_COMMANDS,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
} from '../common/constants/bot-commands';
import { EventsModule } from '../events/events.module';
import { EventsScheduler } from '../events/events.scheduler';
import { GroupsModule } from '../groups/groups.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SearchModule } from '../search/search.module';
import { UsersModule } from '../users/users.module';
import { VacanciesModule } from '../vacancies/vacancies.module';
import { BotFlowService } from './bot-flow.service';
import { BotUpdate } from './bot.update';

class BotCommandInitializer implements OnModuleInit {
  constructor(@InjectBot() private readonly bot: Telegraf) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.bot.telegram.setMyCommands([...BOT_COMMANDS]),
      this.bot.telegram.setMyDescription(BOT_DESCRIPTION),
      this.bot.telegram.setMyDescription(BOT_DESCRIPTION, 'uz'),
      this.bot.telegram.setMyShortDescription(BOT_SHORT_DESCRIPTION),
      this.bot.telegram.setMyShortDescription(BOT_SHORT_DESCRIPTION, 'uz'),
    ]);
  }
}

@Module({
  imports: [
    ConfigModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.getOrThrow<string>('BOT_TOKEN');
        const domain = (config.get<string>('WEBHOOK_DOMAIN') ?? '').trim();
        if (domain) {
          return {
            token,
            launchOptions: false,
          };
        }
        return {
          token,
          launchOptions: { dropPendingUpdates: false },
        };
      },
    }),
    UsersModule,
    ProfilesModule,
    GroupsModule,
    SearchModule,
    EventsModule,
    VacanciesModule,
  ],
  providers: [BotUpdate, BotFlowService, EventsScheduler, BotCommandInitializer],
})
export class BotModule {}
