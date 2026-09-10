import {
  hasProfileRequiredKey,
  parseFreeformProfileMessage,
  parseProfileMessage,
} from '../src/common/utils/profile-parser';

describe('parseProfileMessage', () => {
  it('parses Uzbek standardized profile fields', () => {
    const result = parseProfileMessage(`Ism: Ali
Soha: Backend Developer
Yosh: 24
Kompaniya: EPAM
Hobby: football, reading
Texnologiyalar: Node.js, NestJS, PostgreSQL
Description: Networkingga qiziqaman.`);

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      name: 'Ali',
      field: 'Backend Developer',
      age: 24,
      company: 'EPAM',
      hobbies: 'football, reading',
      technologies: 'Node.js, NestJS, PostgreSQL',
      description: 'Networkingga qiziqaman.',
    });
  });

  it('requires name and field', () => {
    const result = parseProfileMessage('Yosh: 24');
    expect(result.matched).toBe(true);
    expect(result.errors).toContain('Ism majburiy.');
    expect(result.errors).toContain('Soha majburiy.');
  });

  it('rejects invalid age', () => {
    const result = parseProfileMessage('Ism: Ali\nSoha: Backend\nYosh: abc');
    expect(result.data).toBeUndefined();
    expect(result.errors).toHaveLength(1);
  });

  it('ignores ordinary group messages', () => {
    expect(parseProfileMessage('Bugun meetup bormi?')).toEqual({
      matched: false,
      errors: [],
    });
  });

  it('parses standardized fields written on one line after a greeting', () => {
    const result = parseProfileMessage(
      'Assalomu aleykum Ism: Abdurahmon Soha: FullStack .Net NodeJs + VueJs Kompaniya: universal bank Hobby: - Description: startup loyihalarga qiziqaman',
    );

    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({
      name: 'Abdurahmon',
      field: 'FullStack .Net NodeJs + VueJs',
      company: 'universal bank',
      hobbies: null,
      description: 'startup loyihalarga qiziqaman',
    });
  });

  it('accepts Ismim as a profile name key', () => {
    const result = parseProfileMessage(`Ismim: Sherzod
Soha: Frontend developer
Kompaniya: Koreya kompaniyasida ishlayman
Hobby: Big tennis, table tennis, Football, chess (all types).`);

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      name: 'Sherzod',
      field: 'Frontend developer',
      age: undefined,
      company: 'Koreya kompaniyasida ishlayman',
      hobbies: 'Big tennis, table tennis, Football, chess (all types).',
      technologies: undefined,
      description: undefined,
    });
  });
});

describe('hasProfileRequiredKey', () => {
  it('requires identity or profession keys before group profile parsing', () => {
    expect(
      hasProfileRequiredKey(`Assalomu alaykum.
Kimdir frontend boyicha ish qidirayotgan bolsa, vakansiya bor.
Texnologiya: Vue.js.
Daraja: kamida Middle`),
    ).toBe(false);

    expect(
      hasProfileRequiredKey(`Ismim: Sherzod
Soha: Frontend developer`),
    ).toBe(true);
  });
});

describe('parseFreeformProfileMessage', () => {
  it('extracts an engineer introduction and keeps the source as description', () => {
    const result = parseFreeformProfileMessage(
      `Assalomu alaykum,
Ismim Behzod.
Hozirda Software Engineer sifatida logistika kompaniyasida ishlayman.
Havaskor sifatida stol tennisi va futbolga qiziqaman.`,
      'Telegram Name',
    );

    expect(result).toMatchObject({
      name: 'Behzod',
      field: 'Software Engineer',
      company: 'logistika kompaniyasi',
      hobbies: 'stol tennisi, futbol',
    });
    expect(result?.description).toContain('Ismim Behzod');
  });

  it('extracts a Flutter developer and musical hobbies', () => {
    const result = parseFreeformProfileMessage(
      `Assalomu alaykum. Ismim Sanjarbek Flutter Mobile dasturchiman.
Bo'sh vaqtlarimda Nay, Piano chalaman. Sportga qiziqaman.`,
      'Fallback',
    );

    expect(result).toMatchObject({
      name: 'Sanjarbek',
      field: 'Flutter Mobile Dasturchi',
      technologies: 'Flutter',
      hobbies: 'piano, nay, sport',
    });
  });

  it('uses Telegram name and project field for an informal project post', () => {
    const result = parseFreeformProfileMessage(
      'Hammaga salom, bizda loyihamiz bitdi. Saytni ishlatib ko‘ring va baho bering.',
      'Javohir',
    );
    expect(result).toMatchObject({
      name: 'Javohir',
      field: 'Loyiha muallifi',
    });
  });

  it('does not treat ordinary short messages as profiles', () => {
    expect(parseFreeformProfileMessage('Bugun meetup bormi?', 'Ali')).toBeNull();
  });

  it('recognizes a student introduction without an Ismim phrase', () => {
    const result = parseFreeformProfileMessage(
      "Men Abdukarim Qarshiyev, PDP University'da Software Engineering (Java Backend) yo'nalishda 2-kurs talabasiman.",
      'Abdukarim Qarshiyev',
    );

    expect(result).toMatchObject({
      name: 'Abdukarim Qarshiyev',
    });
    expect(result?.field).not.toBe('Aniqlanmadi — tavsifga qarang');
  });

  it('recognizes age written as Yoshim 24 da', () => {
    const result = parseFreeformProfileMessage(
      "Ismim Habib, yoshim 24 da. Startup Garage da backend dasturchi bo'lib ishlayman.",
      'Habib Toshev',
    );

    expect(result).toMatchObject({
      name: 'Habib',
      age: 24,
      field: 'Backend Developer',
    });
  });

  it('recognizes a learner introduction using Uzbek apostrophe variants', () => {
    const result = parseFreeformProfileMessage(
      "Men Turg'un Abdusattarov, hozirda Frontend dasturlash yoʻnalishini oʻrganyabman.",
      "Turg'un Abdusattarov",
    );

    expect(result).toMatchObject({
      name: "Turg'un Abdusattarov",
      field: 'Frontend o‘rganuvchi',
    });
  });

  it('does not import greetings, reactions, advertisements, or unrelated links', () => {
    expect(parseFreeformProfileMessage('Assalomu alaykum', 'Ali')).toBeNull();
    expect(parseFreeformProfileMessage('Assalomu alaykum +', 'Ali')).toBeNull();
    expect(
      parseFreeformProfileMessage(
        'Have your say on the best goals of the FIFA World Cup 2026! https://example.com',
        'Ali',
      ),
    ).toBeNull();
    expect(
      parseFreeformProfileMessage(
        'IT va Telegram xizmatlari: kanalga nakrutka, Telegram bot, design va vebsayt.',
        'Ali',
      ),
    ).toBeNull();
  });
});
