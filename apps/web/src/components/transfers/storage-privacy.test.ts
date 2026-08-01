import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('transfer browser storage privacy', () => {
  it('does not persist financial or authorization data in browser storage', () => {
    const root = resolve(process.cwd(), 'src', 'components', 'transfers');
    for (const file of [
      'transfer-form.tsx',
      'transfer-list.tsx',
      'transfer-record.tsx',
      'receiving-reference.tsx',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/localStorage|sessionStorage/u);
    }
  });
});
