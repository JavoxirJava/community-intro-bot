import { parseProfileMessage } from '../src/common/utils/profile-parser';

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
});
