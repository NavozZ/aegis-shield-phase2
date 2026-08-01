import assert from 'node:assert/strict';
import test from 'node:test';
import {
  internalLedgerTransferCommandSchema,
  lkrAmountToMinorUnits,
  transferConfirmationRequestSchema,
  transferListQuerySchema,
  transferPreviewRequestSchema,
} from './v1.js';

test('converts LKR decimals exactly without Number precision loss', () => {
  assert.equal(lkrAmountToMinorUnits('1'), '100');
  assert.equal(lkrAmountToMinorUnits('1250.50'), '125050');
  assert.equal(
    lkrAmountToMinorUnits('9007199254740993.01'),
    '900719925474099301',
  );
});
test('rejects unsafe decimal input', () => {
  for (const value of ['', ' ', '-1', '0', '1e2', '1,000', '1.234', 'NaN'])
    assert.throws(() => lkrAmountToMinorUnits(value));
});
test('transfer browser contracts are strict and bounded', () => {
  assert.equal(
    transferPreviewRequestSchema.safeParse({
      sourceAccountId: '11111111-1111-4111-8111-111111111111',
      recipientReference: 'AEGIS-ABCD-EFGH-IJKL',
      amount: '1.00',
      customerId: 'x',
    }).success,
    false,
  );
  assert.equal(
    transferConfirmationRequestSchema.safeParse({
      intentToken: 'a'.repeat(43),
      pin: '123456',
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    transferListQuerySchema.safeParse({ pageSize: 51 }).success,
    false,
  );
});
test('Ledger transfer commands reject prototype pollution and raw numeric money', () => {
  assert.equal(
    internalLedgerTransferCommandSchema.safeParse({
      transferId: '11111111-1111-4111-8111-111111111111',
      transferReference: 'AEGIS-TRF-ABCD-EFGH-IJKL',
      senderCustomerId: '22222222-2222-4222-8222-222222222222',
      sourceAccountId: '33333333-3333-4333-8333-333333333333',
      recipientReference: 'AEGIS-ABCD-EFGH-IJKL',
      amountMinor: 100,
      currency: 'LKR',
      idempotencyKey: 'a'.repeat(16),
    }).success,
    false,
  );
});
