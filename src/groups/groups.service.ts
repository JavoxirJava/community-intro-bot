import { Injectable } from '@nestjs/common';
import { Group, GroupMember, Prisma, User } from '@prisma/client';
import { Chat, User as TelegramUser } from 'telegraf/types';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

export type MembershipWithRelations = Prisma.GroupMemberGetPayload<{
  include: { group: true; user: { include: { profile: true } } };
}>;

type TelegramGroupChat = Chat.GroupChat | Chat.SupergroupChat;

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  upsertGroup(chat: TelegramGroupChat): Promise<Group> {
    return this.prisma.group.upsert({
      where: { telegramId: BigInt(chat.id) },
      create: {
        telegramId: BigInt(chat.id),
        title: chat.title,
        username: 'username' in chat ? chat.username : null,
        type: chat.type,
      },
      update: {
        title: chat.title,
        username: 'username' in chat ? (chat.username ?? null) : null,
        type: chat.type,
        isActive: true,
      },
    });
  }

  async ensureMembership(
    chat: TelegramGroupChat,
    telegramUser: TelegramUser,
    resetVisibility = false,
  ): Promise<MembershipWithRelations> {
    const [group, user] = await Promise.all([
      this.upsertGroup(chat),
      this.users.upsertTelegramUser(telegramUser),
    ]);

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
    });
    await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id },
      update: {
        isActive: true,
        leftAt: null,
        ...(resetVisibility || !existing?.isActive
          ? { joinedAt: new Date(), profileVisible: false }
          : {}),
      },
    });

    return (await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      include: { group: true, user: { include: { profile: true } } },
    }))!;
  }

  async leave(chatId: number, telegramUserId: number): Promise<void> {
    const group = await this.prisma.group.findUnique({
      where: { telegramId: BigInt(chatId) },
    });
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUserId) },
    });
    if (!group || !user) return;

    await this.prisma.groupMember.updateMany({
      where: { groupId: group.id, userId: user.id, isActive: true },
      data: { isActive: false, profileVisible: false, leftAt: new Date() },
    });
  }

  async deactivateGroup(chatId: number): Promise<void> {
    const group = await this.prisma.group.findUnique({
      where: { telegramId: BigInt(chatId) },
    });
    if (!group) return;
    await this.prisma.$transaction([
      this.prisma.group.update({ where: { id: group.id }, data: { isActive: false } }),
      this.prisma.groupMember.updateMany({
        where: { groupId: group.id, isActive: true },
        data: { isActive: false, profileVisible: false, leftAt: new Date() },
      }),
    ]);
  }

  setVisibility(memberId: string, visible: boolean): Promise<GroupMember> {
    return this.prisma.groupMember.update({
      where: { id: memberId },
      data: { profileVisible: visible },
    });
  }

  findMembershipForVisibility(memberId: string): Promise<MembershipWithRelations | null> {
    return this.prisma.groupMember.findUnique({
      where: { id: memberId },
      include: { group: true, user: { include: { profile: true } } },
    });
  }

  async findActiveMembership(chatId: number, userId: string): Promise<GroupMember | null> {
    return this.prisma.groupMember.findFirst({
      where: {
        userId,
        isActive: true,
        group: { telegramId: BigInt(chatId), isActive: true },
      },
    });
  }

  async getGroupAndUser(
    chatId: number,
    telegramUserId: number,
  ): Promise<{ group: Group; user: User } | null> {
    const [group, user] = await Promise.all([
      this.prisma.group.findUnique({ where: { telegramId: BigInt(chatId) } }),
      this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramUserId) } }),
    ]);
    return group && user ? { group, user } : null;
  }
}
