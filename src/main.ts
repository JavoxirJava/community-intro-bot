import 'reflect-metadata';
import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getBotToken } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const webhookDomain = (process.env.WEBHOOK_DOMAIN ?? '').trim();
  const webhookPath = (process.env.WEBHOOK_PATH ?? '/community-intro/webhook').trim();
  const webhookSecret = (process.env.WEBHOOK_SECRET ?? '').trim();

  if (webhookDomain) {
    if (webhookSecret.length < 16) {
      throw new Error('WEBHOOK_DOMAIN bilan WEBHOOK_SECRET (kamida 16 belgi) shart');
    }
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    const bot = app.get<Telegraf>(getBotToken());
    const port = Number(process.env.WEB_PORT ?? 8788);
    const host = process.env.WEB_HOST ?? '127.0.0.1';
    const server = createServer(bot.webhookCallback(webhookPath, { secretToken: webhookSecret }));
    await new Promise<void>((resolve, reject) => {
      server.listen(port, host, () => resolve());
      server.on('error', reject);
    });
    const base = webhookDomain.replace(/\/$/, '');
    await bot.telegram.setWebhook(`${base}${webhookPath}`, { secret_token: webhookSecret });
    Logger.log(`Community Intro Bot webhook ${host}:${port}${webhookPath}`, 'Bootstrap');
    const close = (): void => {
      server.close();
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('Community Intro Bot is running in long-polling mode', 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
