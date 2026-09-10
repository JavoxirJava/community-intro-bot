import { Injectable } from '@nestjs/common';
import { Prisma, Profile } from '@prisma/client';
import { ProfileInput } from '../common/utils/profile-parser';
import { escapeHtml } from '../common/utils/telegram-mention.util';
import { PrismaService } from '../prisma/prisma.service';

export type ProfileWithUser = Prisma.ProfileGetPayload<{ include: { user: true } }>;

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByUserId(userId: string): Promise<Profile | null> {
    return this.prisma.profile.findFirst({ where: { userId, isActive: true } });
  }

  findAnyByUserId(userId: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { userId } });
  }

  save(userId: string, input: ProfileInput): Promise<Profile> {
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...input, isActive: true },
      update: { ...input, isActive: true, deletedAt: null },
    });
  }

  async deactivate(userId: string): Promise<{ profile: Profile; groupChatIds: bigint[] } | null> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.profile.findFirst({ where: { userId, isActive: true } });
      if (!profile) return null;

      const memberships = await tx.groupMember.findMany({
        where: {
          userId,
          isActive: true,
          profileVisible: true,
          group: { isActive: true },
        },
        select: { group: { select: { telegramId: true } } },
      });

      const updated = await tx.profile.update({
        where: { id: profile.id },
        data: { isActive: false, deletedAt: new Date() },
      });
      await tx.groupMember.updateMany({
        where: { userId, profileVisible: true },
        data: { profileVisible: false },
      });

      return { profile: updated, groupChatIds: memberships.map((m) => m.group.telegramId) };
    });
  }

  format(profile: ProfileWithUser | (Profile & { user?: undefined })): string {
    const lines = [
      `<b>Ism:</b> ${escapeHtml(profile.name)}`,
      `<b>Soha:</b> ${escapeHtml(profile.field)}`,
    ];
    if (profile.age) lines.push(`<b>Yosh:</b> ${profile.age}`);
    if (profile.company) lines.push(`<b>Kompaniya:</b> ${escapeHtml(profile.company)}`);
    if (profile.technologies) {
      lines.push(`<b>Texnologiyalar:</b> ${escapeHtml(profile.technologies)}`);
    }
    if (profile.hobbies) lines.push(`<b>Hobby:</b> ${escapeHtml(profile.hobbies)}`);
    if (profile.description) {
      lines.push(`<b>Description:</b> ${escapeHtml(profile.description)}`);
    }
    if ('user' in profile && profile.user?.username) {
      lines.push(`<b>Telegram:</b> @${escapeHtml(profile.user.username)}`);
    }
    return lines.join('\n');
  }

  formatInput(profile: ProfileInput): string {
    const lines = [
      `<b>Ism:</b> ${escapeHtml(profile.name)}`,
      `<b>Soha:</b> ${escapeHtml(profile.field)}`,
    ];
    if (profile.age) lines.push(`<b>Yosh:</b> ${profile.age}`);
    if (profile.company) lines.push(`<b>Kompaniya:</b> ${escapeHtml(profile.company)}`);
    if (profile.technologies) {
      lines.push(`<b>Texnologiyalar:</b> ${escapeHtml(profile.technologies)}`);
    }
    if (profile.hobbies) lines.push(`<b>Hobby:</b> ${escapeHtml(profile.hobbies)}`);
    if (profile.description) {
      lines.push(`<b>Description:</b> ${escapeHtml(profile.description)}`);
    }
    return lines.join('\n');
  }
}
