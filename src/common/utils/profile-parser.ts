export interface ProfileInput {
  name: string;
  field: string;
  age?: number | null;
  company?: string | null;
  hobbies?: string | null;
  technologies?: string | null;
  description?: string | null;
}

export interface ProfileParseResult {
  matched: boolean;
  data?: ProfileInput;
  errors: string[];
}

const KEY_MAP: Record<string, keyof ProfileInput> = {
  ism: 'name',
  ismim: 'name',
  'mening ismim': 'name',
  'to‘liq ismim': 'name',
  "to'liq ismim": 'name',
  name: 'name',
  soha: 'field',
  soham: 'field',
  field: 'field',
  kasb: 'field',
  kasbim: 'field',
  profession: 'field',
  yosh: 'age',
  age: 'age',
  kompaniya: 'company',
  company: 'company',
  hobby: 'hobbies',
  hobbies: 'hobbies',
  texnologiyalar: 'technologies',
  texnologiya: 'technologies',
  technologies: 'technologies',
  technology: 'technologies',
  description: 'description',
  tavsif: 'description',
  'o‘zim haqimda': 'description',
  "o'zim haqimda": 'description',
};

const REQUIRED_PROFILE_KEYS = [
  'ism',
  'ismim',
  'mening ismim',
  'to‘liq ismim',
  "to'liq ismim",
  'name',
  'soha',
  'soham',
  'field',
  'kasb',
  'kasbim',
  'profession',
];

const PROFILE_KEY_PATTERN = Object.keys(KEY_MAP)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

const REQUIRED_PROFILE_KEY_PATTERN = REQUIRED_PROFILE_KEYS.sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

function cleanOptional(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.trim();
  return cleaned && cleaned !== '-' ? cleaned : null;
}

export function parseProfileMessage(text: string): ProfileParseResult {
  const values: Partial<Record<keyof ProfileInput, string>> = {};
  let matched = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const separator = rawLine.indexOf(':');
    if (separator < 1) continue;
    const key = rawLine.slice(0, separator).trim().toLocaleLowerCase('uz');
    const field = KEY_MAP[key];
    if (!field) continue;
    matched = true;
    values[field] = rawLine.slice(separator + 1).trim();
  }

  const inlineFieldPattern = new RegExp(
    `(?:^|\\s)(${PROFILE_KEY_PATTERN})\\s*:\\s*([\\s\\S]*?)(?=(?:\\s)+(?:${PROFILE_KEY_PATTERN})\\s*:|$)`,
    'giu',
  );
  for (const match of text.matchAll(inlineFieldPattern)) {
    const key = match[1].trim().toLocaleLowerCase('uz');
    const field = KEY_MAP[key];
    if (!field) continue;
    matched = true;
    values[field] = match[2].trim();
  }

  if (!matched) return { matched: false, errors: [] };

  const errors: string[] = [];
  const name = values.name?.trim();
  const field = values.field?.trim();
  if (!name) errors.push('Ism majburiy.');
  if (!field) errors.push('Soha majburiy.');

  let age: number | null | undefined;
  if (values.age !== undefined && values.age.trim() !== '' && values.age.trim() !== '-') {
    age = Number(values.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) {
      errors.push('Yosh 1 dan 120 gacha butun son bo‘lishi kerak.');
    }
  } else if (values.age !== undefined) {
    age = null;
  }

  if (name && name.length > 100) errors.push('Ism 100 belgidan oshmasligi kerak.');
  if (field && field.length > 150) errors.push('Soha 150 belgidan oshmasligi kerak.');

  if (errors.length > 0 || !name || !field) return { matched: true, errors };

  return {
    matched: true,
    errors: [],
    data: {
      name,
      field,
      age,
      company: cleanOptional(values.company),
      hobbies: cleanOptional(values.hobbies),
      technologies: cleanOptional(values.technologies),
      description: cleanOptional(values.description),
    },
  };
}

export function hasProfileRequiredKey(text: string): boolean {
  const requiredKeyPattern = new RegExp(`(?:^|\\s)(${REQUIRED_PROFILE_KEY_PATTERN})\\s*:`, 'iu');
  return requiredKeyPattern.test(text);
}

const FREEFORM_SIGNALS =
  /\b(ismim|isim|dasturchi(?:man|si)?|developer(?:man)?|engineer|muhandis|menejer|manager|tester|designer|sysadmin|talaba(?:man|sman|siman)?|o[‘’ʻʼ']?qiyman|o[‘’ʻʼ']?rganya(?:p|b)man|ish[- ]faoliyat|ishlayapman|ishlayman|ishleyman|faoliyat yurit|faoliyat olib bor|loyiham(?:iz)?|founder(?:iman)?|co-founder|qiziqishlar|qiziqaman|shug[‘’ʻʼ']?ullan)\b/iu;

const TECHNOLOGIES: Array<[RegExp, string]> = [
  [/\bnode(?:\.js|js)?\b/iu, 'Node.js'],
  [/\bnestjs\b/iu, 'NestJS'],
  [/\bpostgres(?:ql)?\b/iu, 'PostgreSQL'],
  [/\bflutter\b/iu, 'Flutter'],
  [/\brust\b/iu, 'Rust'],
  [/\bvue(?:\.js|js)?\b/iu, 'Vue.js'],
  [/\bpython\b/iu, 'Python'],
  [/\bjava\b/iu, 'Java'],
  [/\bgo(?:lang)?\b/iu, 'Go'],
  [/\breact native\b/iu, 'React Native'],
  [/\breact(?:\.js|js)?\b/iu, 'React'],
  [/(?:^|\s)(?:\.net|dotnet)\b/iu, '.NET'],
  [/\b(?:machine learning|ml)\b/iu, 'Machine Learning'],
  [/\b(?:deep learning|dl)\b/iu, 'Deep Learning'],
  [/\b(?:artificial intelligence|sun['’‘ʻʼ]?iy intellekt|ai)\b/iu, 'AI'],
];

const HOBBIES: Array<[RegExp, string]> = [
  [/\bstol tennisi\b/iu, 'stol tennisi'],
  [/\bfutbol(?:ga|ni)?\b/iu, 'futbol'],
  [/\bpiano\b/iu, 'piano'],
  [/\bnay\b/iu, 'nay'],
  [/\bkitob|reading\b/iu, 'kitob o‘qish'],
  [/\bsport(?:ga)?\b/iu, 'sport'],
  [/\b(?:tashqi|outdoor) activit/iu, 'tashqi activity'],
  [/\b(?:ping pong|tennis)\b/iu, 'tennis'],
  [/\bhiking\b/iu, 'hiking'],
  [/\bdota1?\b/iu, 'Dota'],
];

export function parseFreeformProfileMessage(
  text: string,
  fallbackName: string,
): ProfileInput | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < 30 || !FREEFORM_SIGNALS.test(normalized)) return null;

  const explicitName = text.match(/(?:^|[\s,.;:!?])ismim\s+([\p{L}ʻʼ'’-]{2,50})/iu)?.[1];
  const name = (explicitName ?? fallbackName).trim().slice(0, 100);
  if (!name) return null;

  const ageMatch =
    normalized.match(/\b(\d{1,3})\s*yosh(?:daman|man)?\b/iu) ??
    normalized.match(/\byoshim\s*(\d{1,3})(?:\s*da)?\b/iu);
  const age = ageMatch ? Number(ageMatch[1]) : undefined;
  const validAge = age && age >= 1 && age <= 120 ? age : undefined;

  const companyMatch = normalized.match(/\b([\p{L}ʻʼ'’-]{2,50})\s+kompaniyasida\b/iu);
  const company = companyMatch ? `${companyMatch[1]} kompaniyasi` : undefined;

  const technologies = TECHNOLOGIES.filter(([pattern]) => pattern.test(normalized)).map(
    ([, label]) => label,
  );
  const hobbies = HOBBIES.filter(([pattern]) => pattern.test(normalized)).map(([, label]) => label);

  let field = inferFreeformField(normalized);
  if (explicitName) {
    field = field.replace(new RegExp(`^${escapeRegExp(explicitName)}\\s+`, 'iu'), '');
  }

  const description =
    text
      .trim()
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 1000) + (text.trim().length > 1000 ? '…' : '');

  return {
    name,
    field: field.slice(0, 150),
    age: validAge,
    company,
    hobbies: hobbies.length ? hobbies.join(', ') : undefined,
    technologies: technologies.length ? technologies.join(', ') : undefined,
    description,
  };
}

function inferFreeformField(text: string): string {
  if (/\bloyiham(?:iz)?\b/iu.test(text)) {
    return /\bqidirilmoqda|hamkor qidir|co-founder\b/iu.test(text)
      ? 'Loyiha asoschisi'
      : 'Loyiha muallifi';
  }

  const knownRoles: Array<[RegExp, string]> = [
    [/\bproject\s*(?:&|and)\s*product manager\b/iu, 'Project & Product Manager'],
    [/\b(?:technical product manager|tpm)\b/iu, 'Technical Product Manager'],
    [/\b(?:project manager|loyiha menejeri)\b/iu, 'Project Manager'],
    [/\bui\s*\/?\s*ux designer\b/iu, 'UI/UX Designer'],
    [/\baqa tester\b/iu, 'AQA Tester'],
    [/\bsysadmin\b/iu, 'Sysadmin'],
    [/\b(?:ml\s*(?:va|\/|&)\s*ai|ai\s*(?:va|\/|&)\s*ml)\s+muhandisi?man\b/iu, 'AI/ML Engineer'],
    [
      /\b(?:machine learning|ml)\b[\s\S]{0,30}\b(?:engineer|muhandis)\b/iu,
      'Machine Learning Engineer',
    ],
    [/\b(?:software engineer|swe)\b/iu, 'Software Engineer'],
    [/\bfrontend\s*\/\s*mobile[\s\S]{0,30}\bdasturchi(?:si|man)?\b/iu, 'Frontend/Mobile Developer'],
    [/\bjava\s+backend\s+(?:dasturchi(?:si|man)?|developer(?:man)?)\b/iu, 'Java Backend Developer'],
    [
      /\bpython(?:da)?\s+backend(?:\s+bo['’‘ʻʼ]?yicha)?\s+(?:dasturchi(?:si|man)?|developer(?:man)?)\b/iu,
      'Python Backend Developer',
    ],
    [/\bflutter(?:\s+mobile)?\s+dasturchi(?:si|man)?\b/iu, 'Flutter Mobile Dasturchi'],
    [/\bmobil\s+dasturchi(?:si|man)?\b/iu, 'Mobile Developer'],
    [/\bandroid\s+dasturchi(?:si|man)?\b/iu, 'Android Dasturchi'],
    [/\bfull\s*[-+ ]?\s*stack\s+dasturchi(?:si|man)?\b/iu, 'Full-stack Dasturchi'],
    [/\bfrontend\s+(?:dasturchi(?:si|man)?|developer(?:man)?|engineer)\b/iu, 'Frontend Developer'],
    [/\bbackend\s+(?:dasturchi(?:si|man)?|developer(?:man)?|engineer)\b/iu, 'Backend Developer'],
    [
      /\bmobile\s*(?:\+\s*backend)?\s+(?:dasturchi(?:si|man)?|developer(?:man)?|engineer)\b/iu,
      'Mobile Developer',
    ],
    [/\bweb\s+dasturchi(?:si|man)?\b/iu, 'Web Developer'],
    [/\bveb\s+dasturchi(?:si|man)?\b/iu, 'Web Developer'],
    [/\bmuhandis\s+dasturchi\b/iu, 'Software Engineer'],
    [/\b(?:founder|asoschi)(?:iman)?\b/iu, 'Loyiha asoschisi'],
    [/\bilmiy tadqiqotchi(?:man)?\b/iu, 'Ilmiy tadqiqotchi'],
    [/\b(?:assistant|assistent|assent)\b/iu, 'IT Academy assistenti'],
    [/\b(?:menejer|manager)\s+bo[‘’ʻʼ']?lib\b/iu, 'Menejer'],
  ];
  for (const [pattern, field] of knownRoles) {
    if (pattern.test(text)) return field;
  }

  const roleMatch = text.match(
    /\b((?:software|backend|frontend|mobile|flutter|rust|full[- ]?stack|devops|data|qa)(?:\s+(?:software|backend|frontend|mobile|flutter|rust|full[- ]?stack|data|qa)){0,2})\s+(dasturchi(?:man)?|engineer(?:man)?|developer(?:man)?)\b/iu,
  );
  if (roleMatch) {
    const role = /dasturchi/iu.test(roleMatch[2]) ? 'dasturchi' : roleMatch[2];
    return `${titleCase(roleMatch[1])} ${titleCase(role)}`;
  }

  const asRoleMatch = text.match(
    /\b(?:hozirda\s+)?([\p{L}+#./&-]+(?:\s+[\p{L}+#./&-]+){0,3})\s+sifatida\b/iu,
  );
  if (asRoleMatch) return titleCase(asRoleMatch[1].replace(/^hozirda\s+/iu, ''));

  const studentMatch = text.match(
    /\b([\p{L}+#./&-]+(?:\s+[\p{L}+#./&-]+){0,4})\s+yo['’‘ʻʼ]?nalish(?:i|ida)?[\s\S]{0,35}\btalaba(?:man|sman|siman)?\b/iu,
  );
  if (studentMatch) return `${titleCase(studentMatch[1])} talabasi`.slice(0, 150);

  if (
    /\b(?:ai|computer vision|nlp|machine learning|deep learning)\b[\s\S]{0,70}\bo[‘’ʻʼ']?rgana?ya(?:p|b)man\b/iu.test(
      text,
    )
  ) {
    return 'AI/ML o‘rganuvchi';
  }

  if (/\bai\s+(?:and|va)\s+robotics\b[\s\S]{0,50}\bo[‘’ʻʼ']?qiyman\b/iu.test(text)) {
    return 'AI and Robotics talabasi';
  }

  if (/\btalaba(?:man|sman|siman)?\b/iu.test(text)) return 'Talaba';

  const learnerMatch = text.match(
    /\b(frontend|backend|mobile|web|ui\s*\/?\s*ux|java|python)[\s\S]{0,35}\bo[‘’ʻʼ']?rganya(?:p|b)man\b/iu,
  );
  if (learnerMatch) return `${titleCase(learnerMatch[1])} o‘rganuvchi`;

  return 'Aniqlanmadi — tavsifga qarang';
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toLocaleUpperCase('uz') + part.slice(1))
    .join(' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
