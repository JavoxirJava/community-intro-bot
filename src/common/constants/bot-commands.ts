export const BOT_COMMANDS = [
  { command: 'start', description: 'Bot haqida ma’lumot' },
  { command: 'profile', description: 'Profil yaratish' },
  { command: 'editprofile', description: 'Profilni tahrirlash' },
  { command: 'myprofile', description: 'Mening profilim' },
  { command: 'deleteprofile', description: 'Profilni o‘chirish' },
  { command: 'info', description: 'Guruh a’zosini topish' },
  { command: 'search', description: 'Ism bo‘yicha qidirish' },
  { command: 'event', description: 'Tadbir yaratish (admin)' },
] as const;

export const PROFILE_EXAMPLE = `Ism: Ali
Soha: Backend Developer
Kompaniya: EPAM
Hobby: football
Description: Backend va networkingga qiziqaman.`;
