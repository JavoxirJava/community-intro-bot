import { BadRequestException, Logger } from '@nestjs/common';
import { VacancyStatus } from '@prisma/client';
import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { Chat, Message } from 'telegraf/types';
import { PROFILE_EXAMPLE } from '../common/constants/bot-commands';
import {
  hasProfileRequiredKey,
  parseFreeformProfileMessage,
  parseProfileMessage,
} from '../common/utils/profile-parser';
import { escapeHtml, telegramMention } from '../common/utils/telegram-mention.util';
import { EventsService } from '../events/events.service';
import { GroupsService } from '../groups/groups.service';
import { ProfilesService } from '../profiles/profiles.service';
import { SearchResult, SearchService } from '../search/search.service';
import { UsersService } from '../users/users.service';
import { VacanciesService } from '../vacancies/vacancies.service';
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
    private readonly vacancies: VacanciesService,
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
        'Vacansiyalarni ko‘rish: /vacancies',
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
    this.flows.cancel(ctx.from.id, this.isGroup(ctx) ? ctx.chat.id : undefined);
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

  @Command('vacancy')
  async vacancy(@Ctx() ctx: Context): Promise<void> {
    await this.startVacancySubmission(ctx);
  }

  @Command('vakansiya')
  async vakansiya(@Ctx() ctx: Context): Promise<void> {
    await this.startVacancySubmission(ctx);
  }

  @Command('vacancies')
  async vacanciesCommand(@Ctx() ctx: Context): Promise<void> {
    await this.showVacancyGroups(ctx);
  }

  @Command('vakansiyalar')
  async vakansiyalarCommand(@Ctx() ctx: Context): Promise<void> {
    await this.showVacancyGroups(ctx);
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

  @Action(/^vacapp:([ar]):(.+)$/)
  async vacancyApproval(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from) return;
    const match = this.actionMatch(ctx);
    if (!this.vacancies.isOwner(ctx.from.id)) {
      await ctx.answerCbQuery('Bu amal faqat bot egasi uchun.', { show_alert: true });
      return;
    }

    const owner = await this.users.upsertTelegramUser(ctx.from);
    const result =
      match[1] === 'a'
        ? await this.vacancies.approve(match[2], owner.id)
        : await this.vacancies.reject(match[2]);
    const vacancy = result.vacancy;
    if (!vacancy) {
      await ctx.answerCbQuery('Vacansiya topilmadi.', { show_alert: true });
      return;
    }

    const expectedStatus = match[1] === 'a' ? VacancyStatus.APPROVED : VacancyStatus.REJECTED;
    if (!result.changed || vacancy.status !== expectedStatus) {
      await ctx.answerCbQuery('Bu vacansiya allaqachon ko‘rib chiqilgan.', { show_alert: true });
      return;
    }

    const approved = match[1] === 'a';
    await ctx.answerCbQuery(approved ? 'Vacansiya tasdiqlandi.' : 'Vacansiya rad etildi.');
    await this.safeEditMessageText(
      ctx,
      `${approved ? '✅ Tasdiqlandi' : '❌ Rad etildi'}\n\n${this.vacancies.format(vacancy)}`,
    );

    try {
      await ctx.telegram.sendMessage(
        vacancy.creator.telegramId.toString(),
        approved
          ? `Vacansiyangiz tasdiqlandi va ${escapeHtml(vacancy.group.title)} guruh a’zolari uchun ko‘rinadi.\n\n${this.vacancies.format(vacancy, 'list')}`
          : `Vacansiyangiz rad etildi.\n\n${this.vacancies.format(vacancy, 'list')}`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
      );
    } catch (error) {
      this.logger.warn(`Could not notify vacancy creator: ${String(error)}`);
    }
  }

  @Action(/^vacg:([^:]+):(\d+)$/)
  async vacancyPage(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !this.isPrivate(ctx)) return;
    const requester = await this.users.upsertTelegramUser(ctx.from);
    const match = this.actionMatch(ctx);
    const groupId = match[1];
    const page = Number(match[2]);
    const membership = await this.vacancies.findAccessibleGroup(requester.id, groupId);
    if (!membership) {
      await ctx.answerCbQuery(
        'Bu guruh vacansiyalarini ko‘rish uchun guruh a’zosi bo‘lishingiz kerak.',
        {
          show_alert: true,
        },
      );
      return;
    }

    await ctx.answerCbQuery();
    await this.replyVacancyPage(ctx, requester.id, groupId, page, true);
  }

  @Action(/^intro:([yn]):(.+)$/)
  async introConfirmation(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.from || !this.isGroup(ctx)) return;
    const match = this.actionMatch(ctx);
    const membership = await this.groups.findMembershipForVisibility(match[2]);
    const draft = this.flows.getIntroDraft(match[2], ctx.from.id);
    if (
      !membership ||
      !membership.isActive ||
      membership.user.telegramId !== BigInt(ctx.from.id) ||
      membership.group.telegramId !== BigInt(ctx.chat.id) ||
      !draft
    ) {
      await ctx.answerCbQuery('Tasdiqlash muddati tugagan yoki bu amal sizga tegishli emas.', {
        show_alert: true,
      });
      return;
    }

    this.flows.deleteIntroDraft(membership.id);
    if (match[1] === 'n') {
      await ctx.answerCbQuery('Profil saqlanmadi.');
      await ctx.editMessageText('Tanishtirish profili saqlanmadi.');
      return;
    }

    const profile = await this.profiles.save(membership.userId, draft);
    await this.groups.setVisibility(membership.id, true);
    await ctx.answerCbQuery('Profil saqlandi.');
    await ctx.editMessageText(
      `${telegramMention(membership.user)}\n\n${this.profiles.format(profile)}`,
      { parse_mode: 'HTML' },
    );
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

      const vacancyFlow = this.flows.consumeVacancy(ctx.chat.id, ctx.from.id, text);
      if (vacancyFlow.handled) {
        if ('prompt' in vacancyFlow) {
          await ctx.reply(vacancyFlow.prompt);
        } else {
          await this.completeVacancy(ctx, vacancyFlow.completed);
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

    let groupMembership: Awaited<ReturnType<GroupsService['ensureMembership']>> | null = null;
    if (this.isGroup(ctx)) {
      groupMembership = await this.groups.ensureMembership(ctx.chat, ctx.from);
      if (groupMembership.user.profile?.isActive) return;
    }

    const parsed =
      this.isGroup(ctx) && !hasProfileRequiredKey(text)
        ? { matched: false, errors: [] }
        : parseProfileMessage(text);
    if (!parsed.matched) {
      if (!this.isGroup(ctx)) return;
      const fallbackName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
      const inferred = parseFreeformProfileMessage(text, fallbackName);
      if (!inferred) return;

      const membership =
        groupMembership ?? (await this.groups.ensureMembership(ctx.chat, ctx.from));
      this.flows.saveIntroDraft(membership.id, ctx.from.id, inferred);
      await ctx.reply(
        [
          'Xabaringizdan quyidagi profil taxmin qilindi.',
          'Tekshirib, saqlashni tasdiqlang. Keyin /editprofile orqali tuzatishingiz mumkin.',
          '',
          this.profiles.formatInput(inferred),
        ].join('\n'),
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            Markup.button.callback('Ha, saqlash', `intro:y:${membership.id}`),
            Markup.button.callback('Yo‘q, bekor qilish', `intro:n:${membership.id}`),
          ]),
        },
      );
      return;
    }
    if (!parsed.data) {
      await ctx.reply(`Profil formati noto‘g‘ri:\n• ${parsed.errors.join('\n• ')}`);
      return;
    }

    if (this.isGroup(ctx)) {
      const membership =
        groupMembership ?? (await this.groups.ensureMembership(ctx.chat, ctx.from));
      const profile = await this.profiles.save(membership.userId, parsed.data);
      await this.groups.setVisibility(membership.id, true);
      await ctx.reply(`${telegramMention(membership.user)}\n\n${this.profiles.format(profile)}`, {
        parse_mode: 'HTML',
      });
    } else {
      const user = await this.users.upsertTelegramUser(ctx.from);
      const profile = await this.profiles.save(user.id, parsed.data);
      await ctx.reply(`Profil saqlandi.\n\n${this.profiles.format(profile)}`, {
        parse_mode: 'HTML',
      });
    }
  }

  private async startVacancySubmission(ctx: Context): Promise<void> {
    if (!ctx.from || !this.isGroup(ctx)) {
      await ctx.reply('Vacansiya faqat guruh ichida /vacancy orqali qo‘shiladi.');
      return;
    }

    const membership = await this.groups.ensureMembership(ctx.chat, ctx.from);
    const prompt = this.flows.startVacancy(
      ctx.chat.id,
      ctx.from.id,
      membership.groupId,
      membership.userId,
    );
    await ctx.reply(
      [
        'Vacansiyani standart forma bo‘yicha qo‘shamiz.',
        'Yuborganingizdan keyin bot egasi tasdiqlasa, faqat shu guruh a’zolari bot lichkasida ko‘ra oladi.',
        '',
        prompt,
        '',
        'Jarayonni to‘xtatish uchun /cancel yuboring yoki 30 daqiqa kuting.',
      ].join('\n'),
    );
  }

  private async showVacancyGroups(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    if (!this.isPrivate(ctx)) {
      await ctx.reply('Vacansiyalarni bot bilan shaxsiy chatda /vacancies orqali ko‘ring.');
      return;
    }

    const user = await this.users.upsertTelegramUser(ctx.from);
    const dbMemberships = await this.vacancies.accessibleGroups(user.id);
    const memberships: typeof dbMemberships = [];
    for (const membership of dbMemberships) {
      if (await this.hasLiveGroupMembership(ctx, membership.group.telegramId)) {
        memberships.push(membership);
      }
    }
    if (memberships.length === 0) {
      await ctx.reply(
        'Siz a’zo bo‘lgan faol guruh topilmadi. Guruh ichida bot bilan kamida bir marta interaction bo‘lishi kerak.',
      );
      return;
    }

    if (memberships.length === 1) {
      await this.replyVacancyPage(ctx, user.id, memberships[0].groupId, 0, false);
      return;
    }

    await ctx.reply(
      'Qaysi guruh vacansiyalarini ko‘rmoqchisiz?',
      Markup.inlineKeyboard(
        memberships.map((membership) => [
          Markup.button.callback(
            `${this.buttonText(membership.group.title)} (${membership.group._count.vacancies})`,
            `vacg:${membership.groupId}:0`,
          ),
        ]),
      ),
    );
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

  private async completeVacancy(
    ctx: Context & { chat: GroupChat },
    completed: {
      groupId: string;
      creatorId: string;
      data: Parameters<VacanciesService['createPending']>[2];
    },
  ): Promise<void> {
    try {
      const vacancy = await this.vacancies.createPending(
        completed.groupId,
        completed.creatorId,
        completed.data,
      );
      const ownerIds = this.vacancies.ownerTelegramIds();
      if (ownerIds.length === 0) {
        await ctx.reply(
          'Vacansiya qabul qilindi, lekin tasdiqlovchi admin sozlanmagan. Bot egasiga xabar bering.',
        );
        return;
      }

      const approvalText = [
        'Yangi vacansiya tasdiqlashga keldi.',
        '',
        this.vacancies.format(vacancy),
      ].join('\n');
      const notifications = await Promise.allSettled(
        ownerIds.map((ownerId) =>
          ctx.telegram.sendMessage(ownerId.toString(), approvalText, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('Tasdiqlash', `vacapp:a:${vacancy.id}`),
                Markup.button.callback('Rad etish', `vacapp:r:${vacancy.id}`),
              ],
            ]),
          }),
        ),
      );
      const failed = notifications.filter(
        (notification) => notification.status === 'rejected',
      ).length;
      await ctx.reply(
        failed === ownerIds.length
          ? 'Vacansiya qabul qilindi, lekin tasdiqlovchi adminga xabar yuborib bo‘lmadi.'
          : 'Vacansiya qabul qilindi. Tasdiqlangandan keyin shu guruh a’zolari uchun ko‘rinadi.',
      );
    } catch (error) {
      const message =
        error instanceof BadRequestException
          ? error.message
          : 'Vacansiyani yaratishda xatolik yuz berdi.';
      this.logger.warn(`Vacancy creation failed: ${String(error)}`);
      await ctx.reply(`${message}\n/vacancy orqali qayta urinib ko‘ring.`);
    }
  }

  private async replyVacancyPage(
    ctx: Context,
    userId: string,
    groupId: string,
    page: number,
    edit: boolean,
  ): Promise<void> {
    const membership = await this.vacancies.findAccessibleGroup(userId, groupId);
    const canView =
      membership && (await this.hasLiveGroupMembership(ctx, membership.group.telegramId));
    if (!canView) {
      const message = 'Bu guruh vacansiyalarini ko‘rish uchun guruh a’zosi bo‘lishingiz kerak.';
      if (edit) {
        await this.safeEditMessageText(ctx, message);
      } else {
        await ctx.reply(message);
      }
      return;
    }

    let result = await this.vacancies.listApproved(groupId, page);
    if (result.total > 0 && result.page >= result.totalPages) {
      result = await this.vacancies.listApproved(groupId, result.totalPages - 1);
    }

    const text = this.vacancies.formatPage(membership.group.title, result);
    const extra = {
      parse_mode: 'HTML' as const,
      link_preview_options: { is_disabled: true },
      ...this.vacancyPageKeyboard(groupId, result.page, result.totalPages),
    };
    if (edit) {
      await this.safeEditMessageText(ctx, text, extra);
      return;
    }
    await ctx.reply(text, extra);
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

  private vacancyPageKeyboard(groupId: string, page: number, totalPages: number) {
    const nav = [];
    if (page > 0) {
      nav.push(Markup.button.callback('◀️', `vacg:${groupId}:${page - 1}`));
    }
    if (page + 1 < totalPages) {
      nav.push(Markup.button.callback('▶️', `vacg:${groupId}:${page + 1}`));
    }
    return nav.length ? Markup.inlineKeyboard([nav]) : {};
  }

  private buttonText(value: string): string {
    return value.length > 36 ? `${value.slice(0, 35)}…` : value;
  }

  private async hasLiveGroupMembership(ctx: Context, groupTelegramId: bigint): Promise<boolean> {
    if (!ctx.from) return false;
    try {
      const member = await ctx.telegram.getChatMember(groupTelegramId.toString(), ctx.from.id);
      if (member.status === 'left' || member.status === 'kicked') {
        await this.groups.leave(Number(groupTelegramId), ctx.from.id);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Could not verify live group membership: ${String(error)}`);
      return false;
    }
  }

  private async safeEditMessageText(
    ctx: Context,
    text: string,
    extra: Parameters<Context['editMessageText']>[1] = {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    },
  ): Promise<void> {
    try {
      await ctx.editMessageText(text, extra);
    } catch (error) {
      if (!String(error).includes('message is not modified')) throw error;
    }
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
