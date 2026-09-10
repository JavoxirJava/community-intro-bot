import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  parseFreeformProfileMessage,
  parseProfileMessage,
  ProfileInput,
} from '../src/common/utils/profile-parser';

interface CsvMember {
  ism: string;
  first_name: string;
  last_name: string;
  username: string;
  user_id: string;
  tanishtirgan: string;
  namuna: string;
}

interface PreparedMember {
  row: CsvMember;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  profile: ProfileInput | null;
}

function loadEnvFile(filePath: string): void {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function getArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseCsv(contents: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];

    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error('CSV ichida yopilmagan qo‘shtirnoq bor.');
  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ''));
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

function readMembers(filePath: string): CsvMember[] {
  const rows = parseCsv(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  const headers = rows.shift();
  if (!headers) throw new Error('CSV bo‘sh.');

  const requiredHeaders = [
    'ism',
    'first_name',
    'last_name',
    'username',
    'user_id',
    'tanishtirgan',
    'namuna',
  ];
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) throw new Error(`CSV ustuni topilmadi: ${header}`);
  }

  return rows.map((cells) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
    return record as unknown as CsvMember;
  });
}

function prepareMember(row: CsvMember): PreparedMember {
  const telegramId = BigInt(row.user_id.trim());
  const username = row.username.trim().replace(/^@/, '') || null;
  const fallbackName = row.ism.trim() || row.first_name.trim() || `Telegram user ${telegramId}`;
  const firstName = row.first_name.trim() || fallbackName;
  const lastName = row.last_name.trim() || null;
  const introduction =
    row.tanishtirgan.trim().toLocaleLowerCase('uz') === 'ha' ? row.namuna.trim() : '';

  let profile: ProfileInput | null = null;
  if (introduction) {
    const structured = parseProfileMessage(introduction);
    profile =
      structured.data ?? parseFreeformProfileMessage(introduction, fallbackName.slice(0, 100));
  }

  return {
    row,
    telegramId,
    username,
    firstName,
    lastName,
    profile,
  };
}

async function main(): Promise<void> {
  loadEnvFile(resolve(process.cwd(), '.env'));

  const filePath = resolve(
    getArgument('file') ?? '/home/javohir/Downloads/Telegram Desktop/members.csv',
  );
  const groupTelegramIdArgument = getArgument('group-id');
  if (!groupTelegramIdArgument) {
    throw new Error('--group-id argumenti majburiy.');
  }

  const apply = process.argv.includes('--apply');
  const showSkipped = process.argv.includes('--show-skipped');
  const showProfiles = process.argv.includes('--show-profiles');
  const members = readMembers(filePath).map(prepareMember);
  const uniqueTelegramIds = new Set(members.map((member) => member.telegramId.toString()));
  if (uniqueTelegramIds.size !== members.length) {
    throw new Error('CSVda takrorlangan user_id mavjud.');
  }

  const prisma = new PrismaClient();
  try {
    const groupTelegramId = BigInt(groupTelegramIdArgument);
    const group = await prisma.group.findUnique({
      where: { telegramId: groupTelegramId },
    });
    if (!group) throw new Error(`Guruh bazada topilmadi: ${groupTelegramId}`);

    const existingUsers = await prisma.user.findMany({
      where: { telegramId: { in: members.map((member) => member.telegramId) } },
      include: {
        profile: true,
        groupMemberships: { where: { groupId: group.id } },
      },
    });
    const existingByTelegramId = new Map(
      existingUsers.map((user) => [user.telegramId.toString(), user]),
    );

    const introducedRows = members.filter(
      (member) =>
        member.row.tanishtirgan.trim().toLocaleLowerCase('uz') === 'ha' && member.row.namuna.trim(),
    );
    const parsedProfiles = introducedRows.filter((member) => member.profile);
    const rejectedIntroductions = introducedRows.filter((member) => !member.profile);
    const profilesToCreate = parsedProfiles.filter(
      (member) => !existingByTelegramId.get(member.telegramId.toString())?.profile,
    );
    const existingProfiles = parsedProfiles.filter(
      (member) => existingByTelegramId.get(member.telegramId.toString())?.profile,
    );

    console.log(`Guruh: ${group.title} (${group.telegramId})`);
    console.log(`CSV a’zolari: ${members.length}`);
    console.log(`Tanishtiruv matni bor: ${introducedRows.length}`);
    console.log(`Profil sifatida tanildi: ${parsedProfiles.length}`);
    console.log(
      `Oddiy/reklama xabari sifatida o‘tkazib yuboriladi: ${rejectedIntroductions.length}`,
    );
    console.log(`Yangi profil yaratiladi: ${profilesToCreate.length}`);
    console.log(`Mavjud profil o‘zgartirilmaydi: ${existingProfiles.length}`);
    console.log(`Yangi user yozuvi: ${members.length - existingUsers.length}`);
    console.log(
      `Yangi membership: ${
        members.length - existingUsers.filter((user) => user.groupMemberships.length > 0).length
      }`,
    );

    if (showSkipped && rejectedIntroductions.length > 0) {
      console.log('\nProfil sifatida olinmagan qatorlar:');
      for (const member of rejectedIntroductions) {
        console.log(`- ${member.row.ism}: ${member.row.namuna.replace(/\s+/g, ' ').trim()}`);
      }
    }

    if (showProfiles && parsedProfiles.length > 0) {
      console.log('\nAniqlangan profillar:');
      for (const member of parsedProfiles) {
        console.log(`- ${member.profile?.name}: ${member.profile?.field}`);
      }
    }

    if (!apply) {
      console.log('\nDry-run tugadi. Bazaga yozish uchun --apply qo‘shing.');
      return;
    }

    const result = await prisma.$transaction(
      async (tx) => {
        let createdProfiles = 0;
        let preservedProfiles = 0;
        let visibleMemberships = 0;

        for (const member of members) {
          const user = await tx.user.upsert({
            where: { telegramId: member.telegramId },
            create: {
              telegramId: member.telegramId,
              username: member.username,
              firstName: member.firstName,
              lastName: member.lastName,
              isActive: true,
            },
            update: {
              username: member.username ?? undefined,
              firstName: member.firstName,
              lastName: member.lastName,
              isActive: true,
            },
            include: { profile: true },
          });

          let profileIsActive = user.profile?.isActive === true;
          if (member.profile && !user.profile) {
            await tx.profile.create({
              data: {
                userId: user.id,
                ...member.profile,
                isActive: true,
              },
            });
            createdProfiles += 1;
            profileIsActive = true;
          } else if (member.profile && user.profile) {
            preservedProfiles += 1;
          }

          const shouldBeVisible = Boolean(member.profile && profileIsActive);
          await tx.groupMember.upsert({
            where: {
              groupId_userId: {
                groupId: group.id,
                userId: user.id,
              },
            },
            create: {
              groupId: group.id,
              userId: user.id,
              isActive: true,
              profileVisible: shouldBeVisible,
            },
            update: {
              isActive: true,
              leftAt: null,
              ...(shouldBeVisible ? { profileVisible: true } : {}),
            },
          });
          if (shouldBeVisible) visibleMemberships += 1;
        }

        return { createdProfiles, preservedProfiles, visibleMemberships };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    console.log('\nImport muvaffaqiyatli yakunlandi.');
    console.log(`Yaratilgan profillar: ${result.createdProfiles}`);
    console.log(`Saqlab qolingan mavjud profillar: ${result.preservedProfiles}`);
    console.log(`Guruhda ko‘rinadigan profillar: ${result.visibleMemberships}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
