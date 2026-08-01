import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('transaction record print layout', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/app/globals.css'),
    'utf8',
  );

  it('keeps the record readable in black and white and hides navigation controls', () => {
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toContain('background: #fff');
    expect(print).toContain('color: #000');
    expect(print).toMatch(
      /\.workspace-header[\s\S]*\.no-print[\s\S]*display:\s*none/u,
    );
    expect(print).toContain('.receipt');
    expect(print).toContain('@page');
  });

  it('uses responsive grids that avoid horizontal record overflow', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*560px\)[\s\S]*\.receipt dl/u);
    expect(css).not.toMatch(/\.receipt[^}]*width:\s*\d+px/u);
  });
});
