import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { VacanciesService } from './vacancies.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [VacanciesService],
  exports: [VacanciesService],
})
export class VacanciesModule {}
