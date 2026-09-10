import { Injectable } from '@nestjs/common';
import { Profile } from '@prisma/client';
import { EventInput } from '../events/events.service';
import { ProfileInput } from '../common/utils/profile-parser';
import { VacancyInput } from '../vacancies/vacancies.service';

type ProfileKey = keyof ProfileInput;

interface ProfileFlow {
  userId: string;
  mode: 'create' | 'edit';
  step: number;
  data: Partial<ProfileInput>;
  expiresAt: number;
}

interface EventFlow {
  groupId: string;
  creatorId: string;
  step: number;
  data: Partial<EventInput>;
  expiresAt: number;
}

interface VacancyFlow {
  groupId: string;
  creatorId: string;
  step: number;
  data: Partial<VacancyInput>;
  expiresAt: number;
}

interface IntroDraft {
  telegramUserId: number;
  data: ProfileInput;
  expiresAt: number;
}

type FlowResult<T> =
  { handled: false } | { handled: true; prompt: string } | { handled: true; completed: T };

const PROFILE_STEPS: Array<{
  key: ProfileKey;
  prompt: string;
}> = [
  { key: 'name', prompt: 'Ismingizni kiriting:' },
  { key: 'field', prompt: 'Soha yoki kasbingizni kiriting:' },
  { key: 'age', prompt: 'Yoshingizni kiriting (ixtiyoriy):' },
  { key: 'company', prompt: 'Kompaniyangizni kiriting (ixtiyoriy):' },
  { key: 'hobbies', prompt: 'Hobbiylaringizni kiriting (ixtiyoriy):' },
  {
    key: 'technologies',
    prompt: 'Ishlatadigan texnologiyalaringizni kiriting (ixtiyoriy):',
  },
  { key: 'description', prompt: 'O‘zingiz haqingizda qisqacha yozing (ixtiyoriy):' },
];

const EVENT_STEPS: Array<{ key: keyof EventInput; prompt: string }> = [
  { key: 'title', prompt: 'Tadbir nomini kiriting:' },
  { key: 'date', prompt: 'Sanani kiriting (masalan, 31.12.2026):' },
  { key: 'time', prompt: 'Vaqtni kiriting (masalan, 18:30):' },
  { key: 'location', prompt: 'Joylashuvni kiriting:' },
  { key: 'description', prompt: 'Tadbir tavsifini kiriting (- yuborsangiz, bo‘sh qoladi):' },
];

const VACANCY_STEPS: Array<{
  key: keyof VacancyInput;
  prompt: string;
  maxLength: number;
  optional?: boolean;
}> = [
  { key: 'title', prompt: 'Lavozim nomini kiriting:', maxLength: 120 },
  { key: 'company', prompt: 'Kompaniya nomini kiriting:', maxLength: 120 },
  {
    key: 'workFormat',
    prompt: 'Ish formatini kiriting (ofis, remote, hybrid, full-time va hokazo):',
    maxLength: 80,
  },
  { key: 'location', prompt: 'Joylashuvni kiriting:', maxLength: 150 },
  {
    key: 'salary',
    prompt: 'Maosh yoki vilkani kiriting (- yuborsangiz, ko‘rsatilmaydi):',
    maxLength: 120,
    optional: true,
  },
  { key: 'requirements', prompt: 'Asosiy talablarni kiriting:', maxLength: 1000 },
  { key: 'contact', prompt: 'Bog‘lanish uchun kontaktni kiriting:', maxLength: 250 },
  {
    key: 'description',
    prompt: 'Qo‘shimcha tavsifni kiriting (- yuborsangiz, bo‘sh qoladi):',
    maxLength: 1000,
    optional: true,
  },
];

const FLOW_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class BotFlowService {
  private readonly profileFlows = new Map<number, ProfileFlow>();
  private readonly eventFlows = new Map<string, EventFlow>();
  private readonly vacancyFlows = new Map<string, VacancyFlow>();
  private readonly introDrafts = new Map<string, IntroDraft>();

  startProfile(
    telegramUserId: number,
    userId: string,
    mode: 'create' | 'edit',
    profile?: Profile | null,
  ): string {
    const data: Partial<ProfileInput> = profile
      ? {
          name: profile.name,
          field: profile.field,
          age: profile.age,
          company: profile.company,
          hobbies: profile.hobbies,
          technologies: profile.technologies,
          description: profile.description,
        }
      : {};
    this.profileFlows.set(telegramUserId, {
      userId,
      mode,
      step: 0,
      data,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
    return this.profilePrompt(this.profileFlows.get(telegramUserId)!);
  }

  consumeProfile(
    telegramUserId: number,
    text: string,
  ): FlowResult<{
    userId: string;
    data: ProfileInput;
  }> {
    const flow = this.profileFlows.get(telegramUserId);
    if (!flow) return { handled: false };
    if (flow.expiresAt < Date.now()) {
      this.profileFlows.delete(telegramUserId);
      return {
        handled: true,
        prompt: 'Profil yaratish vaqti tugadi. /profile bilan qayta boshlang.',
      };
    }

    const step = PROFILE_STEPS[flow.step];
    const value = text.trim();
    const error = this.setProfileValue(flow, step.key, value);
    if (error) return { handled: true, prompt: `${error}\n\n${this.profilePrompt(flow)}` };

    flow.step += 1;
    flow.expiresAt = Date.now() + FLOW_TTL_MS;
    if (flow.step < PROFILE_STEPS.length) {
      return { handled: true, prompt: this.profilePrompt(flow) };
    }

    this.profileFlows.delete(telegramUserId);
    return {
      handled: true,
      completed: {
        userId: flow.userId,
        data: flow.data as ProfileInput,
      },
    };
  }

  startEvent(chatId: number, telegramUserId: number, groupId: string, creatorId: string): string {
    const key = this.chatUserKey(chatId, telegramUserId);
    this.vacancyFlows.delete(key);
    this.eventFlows.set(key, {
      groupId,
      creatorId,
      step: 0,
      data: {},
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
    return EVENT_STEPS[0].prompt;
  }

  consumeEvent(
    chatId: number,
    telegramUserId: number,
    text: string,
  ): FlowResult<{ groupId: string; creatorId: string; data: EventInput }> {
    const key = this.chatUserKey(chatId, telegramUserId);
    const flow = this.eventFlows.get(key);
    if (!flow) return { handled: false };
    if (flow.expiresAt < Date.now()) {
      this.eventFlows.delete(key);
      return {
        handled: true,
        prompt: 'Tadbir yaratish vaqti tugadi. /event bilan qayta boshlang.',
      };
    }

    const step = EVENT_STEPS[flow.step];
    const value = text.trim();
    if (!value)
      return { handled: true, prompt: `Qiymat bo‘sh bo‘lmasligi kerak.\n\n${step.prompt}` };
    if (value.length > (step.key === 'description' ? 1000 : 250)) {
      return { handled: true, prompt: `Qiymat juda uzun.\n\n${step.prompt}` };
    }
    if (step.key === 'description') {
      flow.data.description = value === '-' ? null : value;
    } else {
      flow.data[step.key] = value;
    }
    flow.step += 1;
    flow.expiresAt = Date.now() + FLOW_TTL_MS;

    if (flow.step < EVENT_STEPS.length) {
      return { handled: true, prompt: EVENT_STEPS[flow.step].prompt };
    }
    this.eventFlows.delete(key);
    return {
      handled: true,
      completed: {
        groupId: flow.groupId,
        creatorId: flow.creatorId,
        data: flow.data as EventInput,
      },
    };
  }

  startVacancy(chatId: number, telegramUserId: number, groupId: string, creatorId: string): string {
    const key = this.chatUserKey(chatId, telegramUserId);
    this.eventFlows.delete(key);
    this.vacancyFlows.set(key, {
      groupId,
      creatorId,
      step: 0,
      data: {},
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
    return VACANCY_STEPS[0].prompt;
  }

  consumeVacancy(
    chatId: number,
    telegramUserId: number,
    text: string,
  ): FlowResult<{ groupId: string; creatorId: string; data: VacancyInput }> {
    const key = this.chatUserKey(chatId, telegramUserId);
    const flow = this.vacancyFlows.get(key);
    if (!flow) return { handled: false };
    if (flow.expiresAt < Date.now()) {
      this.vacancyFlows.delete(key);
      return {
        handled: true,
        prompt: 'Vacansiya qo‘shish vaqti tugadi. /vacancy bilan qayta boshlang.',
      };
    }

    const step = VACANCY_STEPS[flow.step];
    const value = text.trim();
    if (!value) {
      return { handled: true, prompt: `Qiymat bo‘sh bo‘lmasligi kerak.\n\n${step.prompt}` };
    }
    if (!step.optional && value === '-') {
      return { handled: true, prompt: `Bu maydon majburiy.\n\n${step.prompt}` };
    }
    if (value.length > step.maxLength) {
      return {
        handled: true,
        prompt: `Qiymat ${step.maxLength} belgidan oshmasligi kerak.\n\n${step.prompt}`,
      };
    }

    if (step.key === 'salary' || step.key === 'description') {
      flow.data[step.key] = value === '-' ? null : value;
    } else {
      flow.data[step.key] = value;
    }
    flow.step += 1;
    flow.expiresAt = Date.now() + FLOW_TTL_MS;

    if (flow.step < VACANCY_STEPS.length) {
      return { handled: true, prompt: VACANCY_STEPS[flow.step].prompt };
    }
    this.vacancyFlows.delete(key);
    return {
      handled: true,
      completed: {
        groupId: flow.groupId,
        creatorId: flow.creatorId,
        data: flow.data as VacancyInput,
      },
    };
  }

  cancelProfile(telegramUserId: number): void {
    this.profileFlows.delete(telegramUserId);
  }

  cancel(telegramUserId: number, chatId?: number): void {
    this.profileFlows.delete(telegramUserId);
    if (chatId !== undefined) {
      const key = this.chatUserKey(chatId, telegramUserId);
      this.eventFlows.delete(key);
      this.vacancyFlows.delete(key);
    }
  }

  saveIntroDraft(memberId: string, telegramUserId: number, data: ProfileInput): void {
    this.introDrafts.set(memberId, {
      telegramUserId,
      data,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
  }

  getIntroDraft(memberId: string, telegramUserId: number): ProfileInput | null {
    const draft = this.introDrafts.get(memberId);
    if (!draft || draft.telegramUserId !== telegramUserId) return null;
    if (draft.expiresAt < Date.now()) {
      this.introDrafts.delete(memberId);
      return null;
    }
    return draft.data;
  }

  deleteIntroDraft(memberId: string): void {
    this.introDrafts.delete(memberId);
  }

  private profilePrompt(flow: ProfileFlow): string {
    const step = PROFILE_STEPS[flow.step];
    const current = flow.data[step.key];
    const currentText =
      flow.mode === 'edit'
        ? `\nJoriy qiymat: ${current ?? 'bo‘sh'}. “-” — saqlash, “o‘chirish” — tozalash.`
        : step.key === 'name' || step.key === 'field'
          ? ''
          : '\nO‘tkazib yuborish uchun “-” yuboring.';
    return `${step.prompt}${currentText}`;
  }

  private setProfileValue(flow: ProfileFlow, key: ProfileKey, rawValue: string): string | null {
    if (flow.mode === 'edit' && rawValue === '-') return null;
    const clear = rawValue === '-' || rawValue.toLocaleLowerCase('uz') === 'o‘chirish';

    if (key === 'name' || key === 'field') {
      if (clear || !rawValue) return `${key === 'name' ? 'Ism' : 'Soha'} majburiy.`;
      const max = key === 'name' ? 100 : 150;
      if (rawValue.length > max) return `Qiymat ${max} belgidan oshmasligi kerak.`;
      flow.data[key] = rawValue;
      return null;
    }

    if (key === 'age') {
      if (clear) {
        flow.data.age = null;
        return null;
      }
      const age = Number(rawValue);
      if (!Number.isInteger(age) || age < 1 || age > 120) {
        return 'Yosh 1 dan 120 gacha butun son bo‘lishi kerak.';
      }
      flow.data.age = age;
      return null;
    }

    if (!clear && rawValue.length > (key === 'description' ? 1000 : 500)) {
      return 'Qiymat juda uzun.';
    }
    flow.data[key] = clear ? null : rawValue;
    return null;
  }

  private chatUserKey(chatId: number, telegramUserId: number): string {
    return `${chatId}:${telegramUserId}`;
  }
}
