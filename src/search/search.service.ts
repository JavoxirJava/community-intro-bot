import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const resultInclude = {
  group: true,
  user: { include: { profile: true } },
} satisfies Prisma.GroupMemberInclude;

export type SearchResult = Prisma.GroupMemberGetPayload<{ include: typeof resultInclude }>;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchInGroup(chatId: number, query: string): Promise<SearchResult[]> {
    const term = query.trim().replace(/^@/, '');
    if (!term) return [];
    const usernameOnly = query.trim().startsWith('@');

    return this.prisma.groupMember.findMany({
      where: {
        isActive: true,
        profileVisible: true,
        group: { telegramId: BigInt(chatId), isActive: true },
        user: {
          isActive: true,
          profile: {
            isActive: true,
            ...(usernameOnly
              ? {}
              : { name: { contains: term, mode: Prisma.QueryMode.insensitive } }),
          },
          ...(usernameOnly
            ? { username: { equals: term, mode: Prisma.QueryMode.insensitive } }
            : {}),
        },
      },
      include: resultInclude,
      orderBy: { user: { profile: { name: 'asc' } } },
      take: 20,
    });
  }

  findByReplyInGroup(chatId: number, targetTelegramId: number): Promise<SearchResult | null> {
    return this.prisma.groupMember.findFirst({
      where: {
        isActive: true,
        profileVisible: true,
        group: { telegramId: BigInt(chatId), isActive: true },
        user: {
          telegramId: BigInt(targetTelegramId),
          isActive: true,
          profile: { isActive: true },
        },
      },
      include: resultInclude,
    });
  }

  findSelectedInGroup(
    chatId: number,
    groupId: string,
    targetUserId: string,
  ): Promise<SearchResult | null> {
    return this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId: targetUserId,
        isActive: true,
        profileVisible: true,
        group: { telegramId: BigInt(chatId), isActive: true },
        user: { isActive: true, profile: { isActive: true } },
      },
      include: resultInclude,
    });
  }

  async searchPrivate(requesterUserId: string, query: string): Promise<SearchResult[]> {
    const term = query.trim().replace(/^@/, '');
    if (!term) return [];
    const usernameOnly = query.trim().startsWith('@');

    const requesterGroups = await this.prisma.groupMember.findMany({
      where: { userId: requesterUserId, isActive: true, group: { isActive: true } },
      select: { groupId: true },
    });
    const groupIds = requesterGroups.map((membership) => membership.groupId);
    if (groupIds.length === 0) return [];

    return this.prisma.groupMember.findMany({
      where: {
        groupId: { in: groupIds },
        isActive: true,
        profileVisible: true,
        userId: { not: requesterUserId },
        user: {
          isActive: true,
          profile: {
            isActive: true,
            ...(usernameOnly
              ? {}
              : { name: { contains: term, mode: Prisma.QueryMode.insensitive } }),
          },
          ...(usernameOnly
            ? { username: { equals: term, mode: Prisma.QueryMode.insensitive } }
            : {}),
        },
      },
      include: resultInclude,
      orderBy: [{ user: { profile: { name: 'asc' } } }, { group: { title: 'asc' } }],
      take: 30,
    });
  }

  findSelectedPrivate(
    requesterUserId: string,
    groupId: string,
    targetUserId: string,
  ): Promise<SearchResult | null> {
    return this.prisma.groupMember.findFirst({
      where: {
        groupId,
        userId: targetUserId,
        isActive: true,
        profileVisible: true,
        group: {
          isActive: true,
          members: { some: { userId: requesterUserId, isActive: true } },
        },
        user: { isActive: true, profile: { isActive: true } },
      },
      include: resultInclude,
    });
  }
}
