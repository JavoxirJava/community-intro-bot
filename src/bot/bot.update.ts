import { BadRequestException, Logger } from '@nestjs/common';
import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { Chat, Message } from 'telegraf/types';
import { PROFILE_EXAMPLE } from '../common/constants/bot-commands';
import { parseProfileMessage } from '../common/utils/profile-parser';
import { escapeHtml, telegramMention } from '../common/utils/telegram-mention.util';
import { EventsService } from '../events/events.service';
import { GroupsService } from '../groups/groups.service';
import { ProfilesService } from '../profiles/profiles.service';
import { SearchResult, SearchService } from '../search/search.service';
import { UsersService } from '../users/users.service';
import { BotFlowService } from './bot-flow.service';

type GroupChat = Chat.GroupChat | Chat.SupergroupChat;

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly groups: GroupsService,
    private readonly search: SearchService,
    private readonly events: EventsService,
    private readonly flows: BotFlowService,
  ) {}

  @Start()
  async start(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    await this.users.upsertTelegramUser(ctx.from);
    await ctx.reply(
      [
        'Assalomu alaykum! Men guruh a’zolarini tanishtirish va tadbirlarni rejalash botiman.',
        '',
        'Profil yaratish: /profile',
        'Profilni ko‘rish: /myprofile',
        'Qidirish: /search Ali',
      ].join('\n'),
    );
  }

  @Command('profile')
  async profile(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    if (!this.isPrivate(ctx)) {
      await ctx.reply(
        `Profilni bot bilan shaxsiy chatda /profile orqali yarating yoki shu guruhga quyidagi formatda yuboring:\n\n${PROFILE_EXAMPLE}`,
      );
      return;
    }
    const user = await this.users.upsertTelegramUser(ctx.from);
    const existing = await this.profiles.findActiveByUserId(user.id);
    if (existing) {
      await ctx.reply('Sizda faol profil bor. Tahrirlash uchun /editprofile dan foydalaning.');
      return;
    }
    const prompt = this.flows.startProfile(ctx.from.id, user.id, 'create');
    await ctx.reply(
      `Profilni bosqichma-bosqich yaratamiz. Bekor qilish uchun /cancel yuboring.\n\n${prompt}`,
    );
  }

  @Command('editprofile')
  async editProfile(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    if (!this.isPrivate(ctx)) {
      await ctx.reply('Profilni faqat bot bilan shaxsiy chatda tahrirlash mumkin.');
      return;
    }
    const user = await this.users.upsertTelegramUser(ctx.from);
    const existing = await this.profiles.findActiveByUserId(user.id);
    if (!existing) {
      await ctx.reply('Faol profilingiz yo‘q. /profile orqali profil yarating.');
      return;
    }
    const prompt = this.flows.startProfile(ctx.from.id, user.id, 'edit', existing);
    await ctx.reply(`Profilni tahrirlaymiz. Bekor qilish uchun /cancel yuboring.\n\n${prompt}`);
  }

  @Command('cancel')
  async cancel(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    this.flows.cancelProfile(ctx.from.id);
    await ctx.reply('Amal bekor qilindi.');
  }

  @Command('myprofile')
  async myProfile(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    if (!this.isPrivate(ctx)) {
      await ctx.reply('Bu buyruq faqat bot bilan shaxsiy chatda ishlaydi.');
      return;
    }
    const user = await this.users.upsertTelegramUser(ctx.from);
    const profile = await this.profiles.findActiveByUserId(user.id);
    if (!profile) {
      await ctx.reply('Faol profilingiz yo‘q. /profile orqali profil yarating.');
      return;
    }
    await ctx.reply(this.profiles.format(profile), { parse_mode: 'HTML' });
  }

  @Command('deleteprofile')
  async deleteProfile(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    if (!this.isPrivate(ctx)) {
      await ctx.reply('Profilni faqat bot bilan shaxsiy chatda o‘chirish mumkin.');
      return;
    }
    const user = await this.users.upsertTelegramUser(ctx.from);
    const result = await this.profiles.deactivate(user.id);
    if (!result) {
      await ctx.reply('Faol profilingiz yo‘q.');
      return;
    }

    const mention = telegramMention(user);
    const notifications = await Promise.allSettled(
      result.groupChatIds.map((chatId) =>
        ctx.telegram.sendMessage(
          chatId.toString(),
          `${mention} o‘z profilini o‘chirdi. Profil endi qidiruv va /info orqali ko‘rinmaydi.`,
          { parse_mode: 'HTML' },
        ),
      ),
    );
    const failed = notifications.filter(
      (notification) => notification.status === 'rejected',
    ).length;
    await ctx.reply(
      failed === 0
        ? 'Profilingiz faolsizlantirildi va tegishli guruhlarga xabar berildi.'
        : `Profilingiz faolsizlantirildi. ${failed} ta guruhga xabarni yetkazib bo‘lmadi.`,
    );
  }

  @Command('info')
  async info(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;
    const query = this.commandArgument(ctx.message.text);

    if (this.isGroup(ctx)) {
      const reply = this.replyTarget(ctx.message);
      if (reply) {
        const result = await this.search.findByReplyInGroup(ctx.chat.id, reply.id);
        await this.replySearchResult(ctx, result ? [result] : [], false);
        return;
      }
      if (!query) {
        await ctx.reply('/info buyrug‘ini xabarga reply qilib yoki /info Ali shaklida yuboring.');
        return;
      }
      await this.replySearchResult(ctx, await this.search.searchInGroup(ctx.chat.id, query), false);
      return;
    }

    if (!query) {
      await ctx.reply('Shaxsiy qidiruv uchun /info @username yoki /info Ali deb yozing.');
      return;
    }
    const requester = await this.users.upsertTelegramUser(ctx.from);
    await this.replySearchResult(ctx, await this.search.searchPrivate(requester.id, query), true);
  }

  @Command('search')
  async searchCommand(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;
    const query = this.commandArgument(ctx.message.text);
    if (!query) {
      await ctx.reply('Qidiruv so‘zini kiriting. Masalan: /search Ali');
      return;
    }
    if (this.isGroup(ctx)) {
      await this.replySearchResult(ctx, await this.search.searchInGroup(ctx.chat.id, query), false);
      return;
    }
    const requester = await this.users.upsertTelegramUser(ctx.from);
    await this.replySearchResult(ctx, await this.search.searchPrivate(requester.id, query), true);
  }

  @Command('event')
  async event(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !this.isGroup(ctx)) {
      await ctx.reply('Tadbir faqat guruh ichida yaratiladi.');
      return;
    }
    const memberStatus = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (!['administrator', 'creator'].includes(memberStatus.status)) {
      await ctx.reply('Tadbirni faqat guruh admini yaratishi mumkin.');
      return;
    }
    const membership = await this.groups.ensureMembership(ctx.chat, ctx.from);
    const prompt = this.flows.startEvent(
      ctx.chat.id,
      ctx.from.id,
      membership.groupId,
      membership.userId,
    );
    await ctx.reply(`${prompt}\n\nJarayonni to‘xtatish uchun 30 daqiqa kuting.`);
  }

  @On('new_chat_members')
  async newMembers(@Ctx() ctx: Context): Promise<void> {
    if (!this.isGroup(ctx) || !ctx.message || !('new_chat_members' in ctx.message)) return;
    await this.groups.upsertGroup(ctx.chat);
    for (const telegramUser of ctx.message.new_chat_members) {
      if (telegramUser.is_bot) continue;
      const membership = await this.groups.ensureMembership(ctx.chat, telegramUser, true);
      const profile = membership.user.profile;
      if (!profile?.isActive) {
        await ctx.reply(
          `${escapeHtml(telegramUser.first_name)}, guruhga xush kelibsiz! O‘zingizni quyidagi formatda tanishtiring:\n\n${PROFILE_EXAMPLE}`,
          { parse_mode: 'HTML' },
        );
        continue;
      }
      await ctx.reply(
        `${escapeHtml(telegramUser.first_name)}, sizda avvaldan profil mavjud. Shu guruhda profilingizni ko‘rsatamizmi?`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            Markup.button.callback('Ha, chiqarish', `vis:y:${membership.id}`),
            Markup.button.callback('Yo‘q', `vis:n:${membership.id}`),
          ]),
        },
      );
    }
  }

  @On('left_chat_member')
  async leftMember(@Ctx() ctx: Context): Promise<void> {
    if (!this.isGroup(ctx) || !ctx.message || !('left_chat_member' in ctx.message)) return;
    if (ctx.message.left_chat_member.id === ctx.botInfo?.id) {
      await this.groups.deactivateGroup(ctx.chat.id);
      return;
    }
    await this.groups.leave(ctx.chat.id, ctx.message.left_chat_member.id);
  }

  @Action(/^vis:([yn]):(.+)$/)
  async visibilityAction(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !this.isGroup(ctx)) return;
    const match = this.actionMatch(ctx);
    const visible = match[1] === 'y';
    const membership = await this.groups.findMembershipForVisibility(match[2]);
    if (
      !membership ||
      membership.user.telegramId !== BigInt(ctx.from.id) ||
      membership.group.telegramId !== BigInt(ctx.chat.id) ||
      !membership.isActive
    ) {
      await ctx.answerCbQuery('Bu amal siz uchun mavjud emas.', { show_alert: true });
      return;
    }
    const profile = membership.user.profile;
    if (visible && (!profile || !profile.isActive)) {
      await ctx.answerCbQuery('Faol profil topilmadi.', { show_alert: true });
      return;
    }
    await this.groups.setVisibility(membership.id, visible);
    await ctx.answerCbQuery(visible ? 'Profil ko‘rsatildi.' : 'Profil yashirildi.');
    if (visible && profile) {
      await ctx.editMessageText(
        `${telegramMention(membership.user)}\n\n${this.profiles.format(profile)}`,
        { parse_mode: 'HTML' },
      );
    } else {
      await ctx.editMessageText('Profil bu guruhda yashirin qoldi.');
    }
  }

  @Action(/^sg:([^:]+):([^:]+)$/)
  async selectedGroupProfile(@Ctx() ctx: Context): Promise<void> {
    if (!this.isGroup(ctx)) return;
    const match = this.actionMatch(ctx);
    const result = await this.search.findSelectedInGroup(ctx.chat.id, match[1], match[2]);
    await ctx.answerCbQuery(result ? undefined : 'Profil mavjud emas.');
    if (result?.user.profile) {
      await ctx.reply(this.profiles.format(result.user.profile), { parse_mode: 'HTML' });
    }
  }

  @Action(/^sp:([^:]+):([^:]+)$/)
  async selectedPrivateProfile(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !this.isPrivate(ctx)) return;
    const requester = await this.users.upsertTelegramUser(ctx.from);
    const match = this.actionMatch(ctx);
    const result = await this.search.findSelectedPrivate(requester.id, match[1], match[2]);
    await ctx.answerCbQuery(result ? undefined : 'Profil mavjud emas.');
    if (result?.user.profile) {
      await ctx.reply(this.profiles.format(result.user.profile), { parse_mode: 'HTML' });
    }
  }

  @Action(/^event:([jl]):(.+)$/)
  async eventParticipation(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !this.isGroup(ctx)) return;
    const match = this.actionMatch(ctx);
    const existingEvent = await this.events.get(match[2]);
    if (!existingEvent || existingEvent.group.telegramId !== BigInt(ctx.chat.id)) {
      await ctx.answerCbQuery('Tadbir topilmadi.', { show_alert: true });
      return;
    }
    const membership = await this.groups.ensureMembership(ctx.chat, ctx.from);
    const updated = await this.events.setParticipation(
      existingEvent.id,
      membership.userId,
      match[1] === 'j',
    );
    if (!updated) {
      await ctx.answerCbQuery('Tadbir yakunlangan yoki siz guruh a’zosi emassiz.', {
        show_alert: true,
      });
      return;
    }
    await ctx.answerCbQuery(match[1] === 'j' ? 'Tadbirga qo‘shildingiz.' : 'Tadbirdan chiqdingiz.');
    try {
      await ctx.editMessageText(this.events.format(updated), this.eventKeyboard(updated.id));
    } catch (error) {
      if (!String(error).includes('message is not modified')) throw error;
    }
  }

  @On('text')
  async text(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    if (this.isGroup(ctx)) {
      const eventFlow = this.flows.consumeEvent(ctx.chat.id, ctx.from.id, text);
      if (eventFlow.handled) {
        if ('prompt' in eventFlow) {
          await ctx.reply(eventFlow.prompt);
        } else {
          await this.completeEvent(ctx, eventFlow.completed);
        }
        return;
      }
    } else {
      const profileFlow = this.flows.consumeProfile(ctx.from.id, text);
      if (profileFlow.handled) {
        if ('prompt' in profileFlow) {
          await ctx.reply(profileFlow.prompt);
        } else {
          const profile = await this.profiles.save(
            profileFlow.completed.userId,
            profileFlow.completed.data,
          );
          await ctx.reply(`Profil saqlandi.\n\n${this.profiles.format(profile)}`, {
            parse_mode: 'HTML',
          });
        }
        return;
      }
    }

    const parsed = parseProfileMessage(text);
    if (!parsed.matched) return;
    if (!parsed.data) {
      await ctx.reply(`Profil formati noto‘g‘ri:\n• ${parsed.errors.join('\n• ')}`);
      return;
    }

    const user = await this.users.upsertTelegramUser(ctx.from);
    const profile = await this.profiles.save(user.id, parsed.data);
    if (this.isGroup(ctx)) {
      const membership = await this.groups.ensureMembership(ctx.chat, ctx.from);
      await this.groups.setVisibility(membership.id, true);
      await ctx.reply(`${telegramMention(user)}\n\n${this.profiles.format(profile)}`, {
        parse_mode: 'HTML',
      });
    } else {
      await ctx.reply(`Profil saqlandi.\n\n${this.profiles.format(profile)}`, {
        parse_mode: 'HTML',
      });
    }
  }

  private async completeEvent(
    ctx: Context & { chat: GroupChat },
    completed: {
      groupId: string;
      creatorId: string;
      data: Parameters<EventsService['create']>[2];
    },
  ): Promise<void> {
    try {
      const event = await this.events.create(
        completed.groupId,
        completed.creatorId,
        completed.data,
      );
      const fullEvent = await this.events.get(event.id);
      if (!fullEvent) throw new Error('Created event was not found');
      const message = await ctx.reply(
        this.events.format(fullEvent),
        this.eventKeyboard(fullEvent.id),
      );
      await this.events.setMessageId(event.id, message.message_id);
    } catch (error) {
      const message =
        error instanceof BadRequestException
          ? error.message
          : 'Tadbirni yaratishda xatolik yuz berdi.';
      this.logger.warn(`Event creation failed: ${String(error)}`);
      await ctx.reply(`${message}\n/event orqali qayta urinib ko‘ring.`);
    }
  }

  private async replySearchResult(
    ctx: Context,
    results: SearchResult[],
    privateSearch: boolean,
  ): Promise<void> {
    if (results.length === 0) {
      await ctx.reply('Mos va ko‘rinadigan profil topilmadi.');
      return;
    }
    if (results.length === 1 && results[0].user.profile) {
      await ctx.reply(this.profiles.format(results[0].user.profile), { parse_mode: 'HTML' });
      return;
    }
    const buttons = results.map((result) => [
      Markup.button.callback(
        privateSearch
          ? `${result.user.profile?.name ?? result.user.firstName} — ${result.group.title}`
          : (result.user.profile?.name ?? result.user.firstName),
        `${privateSearch ? 'sp' : 'sg'}:${result.groupId}:${result.userId}`,
      ),
    ]);
    await ctx.reply('Kerakli foydalanuvchini tanlang:', Markup.inlineKeyboard(buttons));
  }

  private eventKeyboard(eventId: string) {
    return {
      parse_mode: 'HTML' as const,
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([
        Markup.button.callback('Qo‘shilish', `event:j:${eventId}`),
        Markup.button.callback('Chiqish', `event:l:${eventId}`),
      ]),
    };
  }

  private isPrivate(ctx: Context): ctx is Context & { chat: Chat.PrivateChat } {
    return ctx.chat?.type === 'private';
  }

  private isGroup(ctx: Context): ctx is Context & { chat: GroupChat } {
    return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  }

  private commandArgument(text: string): string {
    return text.trim().split(/\s+/).slice(1).join(' ').trim();
  }

  private replyTarget(message: Message.TextMessage): { id: number } | null {
    if (!message.reply_to_message?.from) return null;
    return { id: message.reply_to_message.from.id };
  }

  private actionMatch(ctx: Context): RegExpExecArray {
    return (ctx as Context & { match: RegExpExecArray }).match;
  }
}
