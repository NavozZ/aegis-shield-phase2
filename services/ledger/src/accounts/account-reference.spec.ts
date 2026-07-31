import {
  maskedAccountReferenceSchema,
  publicAccountReferenceSchema,
} from '@aegis/contracts';
import {
  generatePublicAccountReference,
  maskAccountReference,
} from './account-reference';

describe('account references', () => {
  it('generates references that satisfy the shared contract', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const reference = generatePublicAccountReference();
      expect(publicAccountReferenceSchema.safeParse(reference).success).toBe(
        true,
      );
    }
  });

  it('never emits ambiguous characters in the random groups', () => {
    const groups = Array.from({ length: 200 }, () =>
      generatePublicAccountReference().split('-').slice(1).join(''),
    ).join('');
    expect(groups).not.toMatch(/[IO01]/u);
  });

  it('does not look like a real bank account number', () => {
    expect(generatePublicAccountReference()).toMatch(/^AEGIS-/u);
    expect(generatePublicAccountReference()).not.toMatch(/^\d+$/u);
  });

  it('masks all but the final group', () => {
    const masked = maskAccountReference('AEGIS-4K7P-2R9M-8T3W');
    expect(masked).toBe('AEGIS-****-****-8T3W');
    expect(maskedAccountReferenceSchema.safeParse(masked).success).toBe(true);
    expect(masked).not.toContain('4K7P');
    expect(masked).not.toContain('2R9M');
  });

  it('rejects a malformed reference rather than masking it incorrectly', () => {
    expect(() => maskAccountReference('AEGIS-4K7P')).toThrow(TypeError);
  });

  it('produces distinct references across calls', () => {
    const generated = new Set(
      Array.from({ length: 500 }, () => generatePublicAccountReference()),
    );
    expect(generated.size).toBe(500);
  });
});
