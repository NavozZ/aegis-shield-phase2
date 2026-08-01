import type { TransferDetail } from '@aegis/contracts';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLanguage } from '@/test/render';
import {
  TRANSFER_MAX_POLL_ATTEMPTS,
  TRANSFER_POLL_INTERVAL_MS,
  TransferRecord,
} from './transfer-record';

const mocks = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock('@/lib/api/transfers-client', () => ({
  transfersClient: { detail: mocks.detail },
}));
const completed: TransferDetail = {
  id: '44444444-4444-4444-8444-444444444444',
  displayReference: 'AEGIS-TRF-ABCD-EFGH-JKLM',
  direction: 'SENT',
  status: 'COMPLETED',
  accountId: '22222222-2222-4222-8222-222222222222',
  counterpartyMaskedReference: 'AEGIS-****-****-JKLM',
  amount: { currency: 'LKR', minorUnits: '10000' },
  createdAt: '2026-08-01T09:00:00.000Z',
  completedAt: '2026-08-01T09:00:01.000Z',
  transactionId: '55555555-5555-4555-8555-555555555555',
  balanceAfter: { currency: 'LKR', minorUnits: '40000' },
  failureCode: null,
  ownMaskedReference: 'AEGIS-****-****-ABCD',
};
const processing: TransferDetail = {
  ...completed,
  status: 'PROCESSING',
  completedAt: null,
  transactionId: null,
  balanceAfter: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TransferRecord', () => {
  it('renders a printable safe receipt', async () => {
    mocks.detail.mockResolvedValue(completed);
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const { container } = renderWithLanguage(
      <TransferRecord id={completed.id} />,
    );
    expect(
      await screen.findByText(completed.displayReference),
    ).toBeInTheDocument();
    expect(screen.getByText('LKR 100.00')).toBeInTheDocument();
    expect(screen.getByText('LKR 400.00')).toBeInTheDocument();
    expect(container.textContent).not.toContain(completed.accountId);
    expect(container.textContent).not.toContain(completed.transactionId!);
    await userEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('polls PROCESSING until completion', async () => {
    vi.useFakeTimers();
    mocks.detail
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(completed);
    renderWithLanguage(<TransferRecord id={completed.id} />);
    await act(async () => Promise.resolve());
    expect(screen.getByText('PROCESSING')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSFER_POLL_INTERVAL_MS);
    });
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(mocks.detail).toHaveBeenCalledTimes(2);
  });

  it('cancels polling when unmounted', async () => {
    vi.useFakeTimers();
    mocks.detail.mockResolvedValue(processing);
    const view = renderWithLanguage(<TransferRecord id={completed.id} />);
    await act(async () => Promise.resolve());
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSFER_POLL_INTERVAL_MS * 2);
    });
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });

  it('stops and warns after the bounded polling timeout', async () => {
    vi.useFakeTimers();
    mocks.detail.mockResolvedValue(processing);
    renderWithLanguage(<TransferRecord id={completed.id} />);
    await act(async () => Promise.resolve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        TRANSFER_POLL_INTERVAL_MS * TRANSFER_MAX_POLL_ATTEMPTS,
      );
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /longer than expected/u,
    );
    expect(mocks.detail).toHaveBeenCalledTimes(TRANSFER_MAX_POLL_ATTEMPTS);
  });
});
