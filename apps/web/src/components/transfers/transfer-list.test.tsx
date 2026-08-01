import type { TransferSummary } from '@aegis/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLanguage } from '@/test/render';
import { TransferList } from './transfer-list';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/api/transfers-client', () => ({
  transfersClient: { list: mocks.list },
}));

const sent: TransferSummary = {
  id: '44444444-4444-4444-8444-444444444444',
  displayReference: 'AEGIS-TRF-ABCD-EFGH-JKLM',
  direction: 'SENT',
  status: 'COMPLETED',
  accountId: '22222222-2222-4222-8222-222222222222',
  counterpartyMaskedReference: 'AEGIS-****-****-JKLM',
  amount: { currency: 'LKR', minorUnits: '10000' },
  createdAt: '2026-08-01T09:00:00.000Z',
  completedAt: '2026-08-01T09:00:01.000Z',
};
const received: TransferSummary = {
  ...sent,
  id: '55555555-5555-4555-8555-555555555555',
  direction: 'RECEIVED',
  counterpartyMaskedReference: 'AEGIS-****-****-ABCD',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    transfers: [sent, received],
    nextCursor: null,
  });
});

describe('TransferList', () => {
  it('renders sent and received entries without internal fields', async () => {
    const { container } = renderWithLanguage(<TransferList />);
    expect(await screen.findByText(/Sent · COMPLETED/u)).toBeInTheDocument();
    expect(screen.getByText(/Received · COMPLETED/u)).toBeInTheDocument();
    expect(container.textContent).not.toContain(sent.accountId);
    expect(container.textContent).not.toMatch(
      /customerId|ledgerAccountId|correlationId/u,
    );
  });

  it('binds direction and status filters only when applied', async () => {
    const user = userEvent.setup();
    renderWithLanguage(<TransferList />);
    await screen.findByText(/Sent · COMPLETED/u);
    await user.selectOptions(screen.getByLabelText('Direction'), 'SENT');
    await user.selectOptions(screen.getByLabelText('Status'), 'COMPLETED');
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    const query = mocks.list.mock.calls[1]?.[0] as URLSearchParams;
    expect(query.toString()).toBe('direction=SENT&status=COMPLETED');
  });

  it('loads the next page and deduplicates records', async () => {
    mocks.list
      .mockResolvedValueOnce({ transfers: [sent], nextCursor: 'opaque-cursor' })
      .mockResolvedValueOnce({ transfers: [sent, received], nextCursor: null });
    const user = userEvent.setup();
    renderWithLanguage(<TransferList />);
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(
      await screen.findByText(/Received · COMPLETED/u),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Sent · COMPLETED/u)).toHaveLength(1);
    const query = mocks.list.mock.calls[1]?.[0] as URLSearchParams;
    expect(query.get('cursor')).toBe('opaque-cursor');
  });
});
