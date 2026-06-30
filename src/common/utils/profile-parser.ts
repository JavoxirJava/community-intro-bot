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
  name: 'name',
  soha: 'field',
  field: 'field',
  kasb: 'field',
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
