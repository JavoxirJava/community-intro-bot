import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InjectBot, TelegrafModule } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { BOT_COMMANDS } from '../common/constants/bot-commands';
import { EventsModule } from '../events/events.module';
import { EventsScheduler } from '../events/events.scheduler';
import { GroupsModule } from '../groups/groups.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SearchModule } from '../search/search.module';
import { UsersModule } from '../users/users.module';
import { BotFlowService } from './bot-flow.service';
import { BotUpdate } from './bot.update';

class BotCommandInitializer implements OnModuleInit {
  constructor(@InjectBot() private readonly bot: Telegraf) {}

  async onModuleInit(): Promise<void> {
    await this.bot.telegram.setMyCommands([...BOT_COMMANDS]);
  }
}

@Module({
  imports: [
    ConfigModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.getOrThrow<string>('BOT_TOKEN'),
        launchOptions: { dropPendingUpdates: false },
      }),
    }),
    UsersModule,
    ProfilesModule,
    GroupsModule,
    SearchModule,
    EventsModule,
  ],
  providers: [BotUpdate, BotFlowService, EventsScheduler, BotCommandInitializer],
})
export class BotModule {}
