export const BOT_COMMANDS = [
  { command: 'start', description: 'Bot haqida ma’lumot' },
  { command: 'profile', description: 'Profil yaratish' },
  { command: 'editprofile', description: 'Profilni tahrirlash' },
  { command: 'myprofile', description: 'Mening profilim' },
  { command: 'deleteprofile', description: 'Profilni o‘chirish' },
  { command: 'info', description: 'Guruh a’zosini topish' },
  { command: 'search', description: 'Ism bo‘yicha qidirish' },
  { command: 'event', description: 'Tadbir yaratish (admin)' },
  { command: 'vacancy', description: 'Guruh uchun vacansiya taklif qilish' },
  { command: 'vacancies', description: 'Guruh vacansiyalarini ko‘rish' },
] as const;

export const BOT_SHORT_DESCRIPTION =
  'Guruh a’zolarini tanishtiradi, profillarni topadi, tadbirlar va vacansiyalarni boshqaradi.';

export const BOT_DESCRIPTION = `Community Intro Bot — Telegram guruhlari uchun networking yordamchisi.

👤 O‘zingiz haqingizda profil yarating.
🔎 Guruhdagi mutaxassislarni ism yoki username orqali toping.
🤝 Yangi a’zolar bilan tanishing va hamkorlar toping.
📅 Guruh adminlari tadbir yaratishi, qatnashchilar esa qo‘shilishi mumkin.
💼 Guruh a’zolari vacansiya taklif qilishi, tasdiqdan keyin lichkada ko‘rishi mumkin.
🔒 Har bir guruhning a’zolari va ma’lumotlari boshqa guruhlardan alohida saqlanadi.

Boshlash uchun /start buyrug‘ini yuboring.`;

export const PROFILE_EXAMPLE = `Ism: Ali
Soha: Backend Developer
Kompaniya: EPAM
Hobby: football
Description: Backend va networkingga qiziqaman.`;
