import { Injectable } from '@nestjs/common';
import { Profile } from '@prisma/client';
import { EventInput } from '../events/events.service';
import { ProfileInput } from '../common/utils/profile-parser';

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

const FLOW_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class BotFlowService {
  private readonly profileFlows = new Map<number, ProfileFlow>();
  private readonly eventFlows = new Map<string, EventFlow>();

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
    this.eventFlows.set(this.eventKey(chatId, telegramUserId), {
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
    const key = this.eventKey(chatId, telegramUserId);
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

  cancelProfile(telegramUserId: number): void {
    this.profileFlows.delete(telegramUserId);
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

  private eventKey(chatId: number, telegramUserId: number): string {
    return `${chatId}:${telegramUserId}`;
  }
}
