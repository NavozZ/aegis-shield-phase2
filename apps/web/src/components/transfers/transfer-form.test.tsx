import type {
  CustomerAccountSummary,
  TransferDetail,
  TransferPreviewResponse,
} from '@aegis/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthClientError } from '@/lib/api/auth-client';
import { renderWithLanguage } from '@/test/render';
import { TransferForm } from './transfer-form';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/api/transfers-client', async () => ({
  createTransferIdempotencyKey: () => 'transfer-stable-idempotency-key',
  transfersClient: { preview: mocks.preview, confirm: mocks.confirm },
}));

const account: CustomerAccountSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  maskedReference: 'AEGIS-****-****-ABCD',
  productType: 'TIER0_WALLET',
  status: 'ACTIVE',
  currency: 'LKR',
  createdAt: '2026-08-01T09:00:00.000Z',
};
const preview: TransferPreviewResponse = {
  intentToken: 'a'.repeat(43),
  sourceMaskedReference: account.maskedReference,
  recipientMaskedReference: 'AEGIS-****-****-JKLM',
  amount: { currency: 'LKR', minorUnits: '10001' },
  sourceBalance: { currency: 'LKR', minorUnits: '50000' },
  policy: {
    currency: 'LKR',
    minimum: { currency: 'LKR', minorUnits: '100' },
    maximum: { currency: 'LKR', minorUnits: '5000000' },
    dailyOutgoingMaximum: { currency: 'LKR', minorUnits: '10000000' },
  },
  expiresAt: '2026-08-01T09:05:00.000Z',
};
const completed: TransferDetail = {
  id: '44444444-4444-4444-8444-444444444444',
  displayReference: 'AEGIS-TRF-ABCD-EFGH-JKLM',
  direction: 'SENT',
  status: 'COMPLETED',
  accountId: account.id,
  counterpartyMaskedReference: preview.recipientMaskedReference,
  amount: preview.amount,
  createdAt: '2026-08-01T09:00:01.000Z',
  completedAt: '2026-08-01T09:00:02.000Z',
  transactionId: '55555555-5555-4555-8555-555555555555',
  balanceAfter: { currency: 'LKR', minorUnits: '39999' },
  failureCode: null,
  ownMaskedReference: account.maskedReference,
};

async function reachPreview() {
  const user = userEvent.setup();
  renderWithLanguage(<TransferForm accounts={[account]} />);
  await user.type(
    screen.getByLabelText('Recipient AEGIS reference'),
    'aegis-abcd-efgh-jklm',
  );
  await user.type(screen.getByLabelText('Amount (LKR)'), '100.01');
  await user.click(screen.getByRole('button', { name: 'Preview transfer' }));
  await screen.findByText('Review transfer');
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockResolvedValue(preview);
  mocks.confirm.mockResolvedValue(completed);
});

describe('TransferForm', () => {
  it('parses the amount as an exact decimal string and shows the masked preview', async () => {
    await reachPreview();
    expect(mocks.preview).toHaveBeenCalledWith({
      sourceAccountId: account.id,
      recipientReference: 'AEGIS-ABCD-EFGH-JKLM',
      amount: '100.01',
    });
    expect(screen.getByText('AEGIS-****-****-JKLM')).toBeInTheDocument();
    expect(screen.getByText('LKR 100.01')).toBeInTheDocument();
  });

  it.each(['0', '-1', '1e2', '1.234'])(
    'rejects unsafe amount %s before the API call',
    async (amount) => {
      const user = userEvent.setup();
      renderWithLanguage(<TransferForm accounts={[account]} />);
      await user.type(
        screen.getByLabelText('Recipient AEGIS reference'),
        'AEGIS-ABCD-EFGH-JKLM',
      );
      await user.type(screen.getByLabelText('Amount (LKR)'), amount);
      await user.click(
        screen.getByRole('button', { name: 'Preview transfer' }),
      );
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(mocks.preview).not.toHaveBeenCalled();
    },
  );

  it('requires a six-digit PIN and navigates on completion', async () => {
    const user = await reachPreview();
    const button = screen.getByRole('button', { name: 'Confirm transfer' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Enter your PIN'), '918273');
    await user.click(button);
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith(
        preview.intentToken,
        '918273',
        'transfer-stable-idempotency-key',
      ),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/app/transfers/${completed.id}`);
  });

  it('prevents double submit and reuses the idempotency key after an uncertain retry', async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    mocks.confirm
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(completed);
    const user = await reachPreview();
    await user.type(screen.getByLabelText('Enter your PIN'), '918273');
    const button = screen.getByRole('button', { name: 'Confirm transfer' });
    await user.click(button);
    await user.click(button);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    rejectFirst(new Error('lost response'));
    await screen.findByRole('alert');
    await user.click(button);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.confirm.mock.calls[0]?.[2]).toBe(
      mocks.confirm.mock.calls[1]?.[2],
    );
  });

  it.each([
    ['TRANSFER_STEP_UP_FAILED', 401, 'PIN was incorrect'],
    ['INTENT_EXPIRED', 409, 'preview expired'],
    ['INSUFFICIENT_FUNDS', 409, 'enough funds'],
    ['LIMIT_EXCEEDED', 409, 'daily transfer limit'],
  ])('shows a safe message for %s', async (code, status, message) => {
    mocks.confirm.mockRejectedValue(
      new AuthClientError('authentication_failed', status, code),
    );
    const user = await reachPreview();
    await user.type(screen.getByLabelText('Enter your PIN'), '918273');
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('navigates to polling receipt for PROCESSING', async () => {
    mocks.confirm.mockResolvedValue({
      ...completed,
      status: 'PROCESSING',
      completedAt: null,
      transactionId: null,
      balanceAfter: null,
    });
    const user = await reachPreview();
    await user.type(screen.getByLabelText('Enter your PIN'), '918273');
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(`/app/transfers/${completed.id}`),
    );
  });
});
