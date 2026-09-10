import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Vacancy, VacancyStatus } from '@prisma/client';
import { escapeHtml, telegramMention } from '../common/utils/telegram-mention.util';
import { PrismaService } from '../prisma/prisma.service';

export interface VacancyInput {
  title: string;
  company: string;
  workFormat: string;
  location: string;
  salary?: string | null;
  requirements: string;
  contact: string;
  description?: string | null;
}

const vacancyInclude = {
  group: true,
  creator: true,
  approvedBy: true,
} satisfies Prisma.VacancyInclude;

export type VacancyWithRelations = Prisma.VacancyGetPayload<{ include: typeof vacancyInclude }>;
type ValidatedVacancyInput = Omit<
  Vacancy,
  | 'id'
  | 'groupId'
  | 'creatorId'
  | 'status'
  | 'approvedById'
  | 'approvedAt'
  | 'rejectedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export const VACANCY_PAGE_SIZE = 5;

@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  ownerTelegramIds(): number[] {
    const raw = this.config.get<string>('BOT_OWNER_IDS', '');
    return raw
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
  }

  isOwner(telegramUserId: number): boolean {
    return this.ownerTelegramIds().includes(telegramUserId);
  }

  async createPending(
    groupId: string,
    creatorId: string,
    input: VacancyInput,
  ): Promise<VacancyWithRelations> {
    const data = this.validate(input);
    return this.prisma.vacancy.create({
      data: {
        groupId,
        creatorId,
        ...data,
        status: VacancyStatus.PENDING,
      },
      include: vacancyInclude,
    });
  }

  get(vacancyId: string): Promise<VacancyWithRelations | null> {
    return this.prisma.vacancy.findUnique({
      where: { id: vacancyId },
      include: vacancyInclude,
    });
  }

  async approve(
    vacancyId: string,
    approverId: string,
  ): Promise<{ vacancy: VacancyWithRelations | null; changed: boolean }> {
    const result = await this.prisma.vacancy.updateMany({
      where: { id: vacancyId, status: VacancyStatus.PENDING },
      data: {
        status: VacancyStatus.APPROVED,
        approvedById: approverId,
        approvedAt: new Date(),
        rejectedAt: null,
      },
    });
    return { vacancy: await this.get(vacancyId), changed: result.count === 1 };
  }

  async reject(
    vacancyId: string,
  ): Promise<{ vacancy: VacancyWithRelations | null; changed: boolean }> {
    const result = await this.prisma.vacancy.updateMany({
      where: { id: vacancyId, status: VacancyStatus.PENDING },
      data: {
        status: VacancyStatus.REJECTED,
        rejectedAt: new Date(),
      },
    });
    return { vacancy: await this.get(vacancyId), changed: result.count === 1 };
  }

  accessibleGroups(userId: string) {
    return this.prisma.groupMember.findMany({
      where: {
        userId,
        isActive: true,
        group: { isActive: true },
      },
      include: {
        group: {
          include: {
            _count: {
              select: {
                vacancies: { where: { status: VacancyStatus.APPROVED } },
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
  }

  findAccessibleGroup(userId: string, groupId: string) {
    return this.prisma.groupMember.findFirst({
      where: {
        userId,
        groupId,
        isActive: true,
        group: { isActive: true },
      },
      include: { group: true },
    });
  }

  async listApproved(
    groupId: string,
    page: number,
    pageSize = VACANCY_PAGE_SIZE,
  ): Promise<{ items: VacancyWithRelations[]; total: number; page: number; totalPages: number }> {
    const safePage = Number.isInteger(page) && page > 0 ? page : 0;
    const [items, total] = await Promise.all([
      this.prisma.vacancy.findMany({
        where: {
          groupId,
          status: VacancyStatus.APPROVED,
          group: { isActive: true },
        },
        include: vacancyInclude,
        orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
        skip: safePage * pageSize,
        take: pageSize,
      }),
      this.prisma.vacancy.count({
        where: {
          groupId,
          status: VacancyStatus.APPROVED,
          group: { isActive: true },
        },
      }),
    ]);
    return {
      items,
      total,
      page: safePage,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  format(vacancy: VacancyWithRelations, mode: 'full' | 'list' = 'full'): string {
    const requirements =
      mode === 'list' ? this.truncate(vacancy.requirements, 220) : vacancy.requirements;
    const description = vacancy.description
      ? mode === 'list'
        ? this.truncate(vacancy.description, 180)
        : vacancy.description
      : null;
    const lines = [
      `💼 <b>${escapeHtml(vacancy.title)}</b>`,
      `<b>Kompaniya:</b> ${escapeHtml(vacancy.company)}`,
      `<b>Ish formati:</b> ${escapeHtml(vacancy.workFormat)}`,
      `<b>Joylashuv:</b> ${escapeHtml(vacancy.location)}`,
      vacancy.salary ? `<b>Maosh:</b> ${escapeHtml(vacancy.salary)}` : '',
      `<b>Talablar:</b> ${escapeHtml(requirements)}`,
      `<b>Aloqa:</b> ${escapeHtml(vacancy.contact)}`,
      description ? `<b>Tavsif:</b> ${escapeHtml(description)}` : '',
    ];
    if (mode === 'full') {
      lines.push(
        `<b>Guruh:</b> ${escapeHtml(vacancy.group.title)}`,
        `<b>Yubordi:</b> ${telegramMention(vacancy.creator)}`,
        `<b>Status:</b> ${this.statusLabel(vacancy.status)}`,
      );
    }
    return lines.filter(Boolean).join('\n');
  }

  formatPage(
    groupTitle: string,
    result: { items: VacancyWithRelations[]; total: number; page: number; totalPages: number },
  ): string {
    if (result.total === 0) {
      return `${escapeHtml(groupTitle)} guruhida tasdiqlangan vacansiya hozircha yo‘q.`;
    }

    return [
      `<b>${escapeHtml(groupTitle)} — vacansiyalar</b>`,
      `<b>Sahifa:</b> ${result.page + 1}/${result.totalPages} | <b>Jami:</b> ${result.total}`,
      '',
      result.items
        .map((vacancy, index) => {
          const number = result.page * VACANCY_PAGE_SIZE + index + 1;
          return `<b>${number}.</b> ${this.format(vacancy, 'list')}`;
        })
        .join('\n\n'),
    ].join('\n');
  }

  private validate(input: VacancyInput): ValidatedVacancyInput {
    return {
      title: this.required(input.title, 'Lavozim', 120),
      company: this.required(input.company, 'Kompaniya', 120),
      workFormat: this.required(input.workFormat, 'Ish formati', 80),
      location: this.required(input.location, 'Joylashuv', 150),
      salary: this.optional(input.salary, 'Maosh', 120),
      requirements: this.required(input.requirements, 'Talablar', 1000),
      contact: this.required(input.contact, 'Aloqa', 250),
      description: this.optional(input.description, 'Tavsif', 1000),
    };
  }

  private required(value: string | null | undefined, label: string, maxLength: number): string {
    const cleaned = value?.trim();
    if (!cleaned) throw new BadRequestException(`${label} majburiy.`);
    if (cleaned.length > maxLength) {
      throw new BadRequestException(`${label} ${maxLength} belgidan oshmasligi kerak.`);
    }
    return cleaned;
  }

  private optional(
    value: string | null | undefined,
    label: string,
    maxLength: number,
  ): string | null {
    const cleaned = value?.trim();
    if (!cleaned || cleaned === '-') return null;
    if (cleaned.length > maxLength) {
      throw new BadRequestException(`${label} ${maxLength} belgidan oshmasligi kerak.`);
    }
    return cleaned;
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1).trimEnd()}…`;
  }

  private statusLabel(status: VacancyStatus): string {
    switch (status) {
      case VacancyStatus.PENDING:
        return 'Tasdiq kutilmoqda';
      case VacancyStatus.APPROVED:
        return 'Tasdiqlangan';
      case VacancyStatus.REJECTED:
        return 'Rad etilgan';
      case VacancyStatus.ARCHIVED:
        return 'Arxivlangan';
    }
  }
}
