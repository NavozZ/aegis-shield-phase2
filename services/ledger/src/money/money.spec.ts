import {
  applyDirection,
  parseMinorUnits,
  serializeMinorUnits,
  signedBalanceMinor,
  toMoney,
} from './money';

describe('money', () => {
  it('parses whole-number minor unit strings into BigInt', () => {
    expect(parseMinorUnits('0')).toBe(0n);
    expect(parseMinorUnits('125000')).toBe(125_000n);
    expect(parseMinorUnits('-2599')).toBe(-2599n);
  });

  it('preserves precision beyond Number.MAX_SAFE_INTEGER', () => {
    const beyondSafeInteger = '9007199254740993';
    // Routing this value through a JavaScript number silently loses the last
    // digit, which is exactly why minor units never become numbers.
    expect(String(Number(beyondSafeInteger))).not.toBe(beyondSafeInteger);
    expect(parseMinorUnits(beyondSafeInteger)).toBe(9_007_199_254_740_993n);
    expect(serializeMinorUnits(parseMinorUnits(beyondSafeInteger))).toBe(
      beyondSafeInteger,
    );
  });

  it('rejects fractional, padded and non-numeric amounts', () => {
    for (const invalid of ['1.5', '007', '', '1e3', ' 12', '12 ', 'abc']) {
      expect(() => parseMinorUnits(invalid)).toThrow(TypeError);
    }
  });

  it('serializes money as a decimal string, never a number', () => {
    const money = toMoney('LKR', 0n);
    expect(money).toEqual({ currency: 'LKR', minorUnits: '0' });
    expect(typeof money.minorUnits).toBe('string');
  });

  describe('balance direction by account class', () => {
    it('treats a customer wallet liability as credit-positive', () => {
      // A CREDIT increases what the platform owes the customer.
      expect(signedBalanceMinor('LIABILITY', 0n, 500n)).toBe(500n);
      expect(signedBalanceMinor('LIABILITY', 200n, 500n)).toBe(300n);
    });

    it('treats assets and expenses as debit-positive', () => {
      expect(signedBalanceMinor('ASSET', 500n, 0n)).toBe(500n);
      expect(signedBalanceMinor('EXPENSE', 500n, 200n)).toBe(300n);
    });

    it('treats equity and revenue as credit-positive', () => {
      expect(signedBalanceMinor('EQUITY', 0n, 750n)).toBe(750n);
      expect(signedBalanceMinor('REVENUE', 100n, 750n)).toBe(650n);
    });

    it('reports a negative balance when a liability is over-debited', () => {
      expect(signedBalanceMinor('LIABILITY', 900n, 500n)).toBe(-400n);
    });
  });

  it('accumulates totals on the side matching the posting direction', () => {
    const empty = { debitTotalMinor: 0n, creditTotalMinor: 0n };
    expect(applyDirection('CREDIT', 250n, empty)).toEqual({
      debitTotalMinor: 0n,
      creditTotalMinor: 250n,
    });
    expect(applyDirection('DEBIT', 250n, empty)).toEqual({
      debitTotalMinor: 250n,
      creditTotalMinor: 0n,
    });
  });
});
